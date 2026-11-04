import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import install from '../../agent/wakeups/runtime.mjs';
import { performance } from 'node:perf_hooks';

const contract = JSON.parse(readFileSync(new URL('../wakeups-sandbox/interface-v1.json', import.meta.url)));
function harness() {
  const handlers = new Map(), tools = new Map();
  const h = { sent: [], warnings: [], owner: { managed: true, status: 'owned', sessionFile: 'private-session', generation: 'one' } };
  h.lifecycle = install({
    events: { emit(_event, { respond }) { respond(h.owner); } },
    on(name, callback) { handlers.set(name, callback); },
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage(message, options) { if (h.fail) throw Error('send failed'); h.sent.push({ message, options }); },
  }, contract.tools);
  h.emit = (name, event = {}) => handlers.get(name)?.(event);
  h.call = async (name, args = {}) => {
    assert.ok(tools.has(name), `${name} must be registered`);
    return (await tools.get(name).execute('call', args, undefined, undefined,
      { mode: 'tui', ui: { notify: text => h.warnings.push(text) } })).details;
  };
  h.commit = index => h.emit('message_end', { message: { role: 'custom', ...h.sent[index].message } });
  h.stop = () => h.emit('session_shutdown');
  h.emit('session_start');
  return h;
}

test('shell integration seam rechecks ownership and fences incarnations', () => {
  const h = harness();
  try {
    const owner = h.lifecycle.readOwner(), token = h.lifecycle.getIncarnation();
    assert.equal(h.lifecycle.isCurrent(owner, token), true);
    h.owner = { ...h.owner, generation: 'replacement' };
    assert.equal(h.lifecycle.isCurrent(owner, token), false);
    h.owner = { ...h.owner, generation: owner.generation };
    h.emit('session_start');
    assert.equal(h.lifecycle.isCurrent(owner, token), false);
    h.stop();
    assert.equal(h.lifecycle.isCurrent(owner, undefined), false);
  } finally { h.stop(); }
});

test('synchronous native send failure cancels recurrence rather than retrying', async () => {
  const h = harness();
  try {
    h.fail = true;
    await h.call('wake_every', { every_seconds: 1, reminder: 'x' });
    await pause(1150);
    assert.equal(h.warnings.length, 1);
    assert.deepEqual((await h.call('wake_list')).timers, []);
    h.fail = false;
    await pause(1100);
    assert.equal(h.sent.length, 0);
  } finally { h.stop(); }
});

test('cancellation removes busy unsent work and stale IDs never reach a replacement', async () => {
  const h = harness();
  try {
    const job = await h.call('wake_every', { every_seconds: 1, reminder: 'x' });
    h.emit('agent_start');
    await pause(1150);
    assert.equal(h.sent.length, 0);
    await h.call('wake_cancel', { job_id: job.job_id });
    h.emit('agent_end');
    assert.equal(h.sent.length, 0);
    h.emit('session_start');
    await assert.rejects(h.call('wake_cancel', { job_id: job.job_id }), /WAKEUPS_JOB_NOT_FOUND/);
  } finally { h.stop(); }
});

test('cron uses wall-clock boundaries, repeats automatically, and coalesces a calendar jump', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-01-01T00:00:30Z') });
  const h = harness();
  try {
    const job = await h.call('wake_cron', { expression: '* * * * *', timezone: 'UTC', reminder: 'Calendar action' });
    assert.equal(job.next_at, '2026-01-01T00:01:00.000Z');
    t.mock.timers.tick(30000);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].message.details.due_at, job.next_at);
    h.commit(0);
    t.mock.timers.tick(60000);
    assert.equal(h.sent.length, 2);
    h.commit(1);
    t.mock.timers.setTime(Date.parse('2036-01-01T00:00:00Z'));
    t.mock.timers.tick(30000);
    assert.equal(h.sent.length, 3, 'a decade of missed minutes yields one notice');
    assert.equal((await h.call('wake_list')).timers[0].next_at, '2036-01-01T00:01:00.000Z');
  } finally { h.stop(); }
});

test('late elapsed callback advances fixed-rate cadence past missed ticks without replay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-01-01T00:00:00Z') });
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  const h = harness();
  try {
    await h.call('wake_every', { every_seconds: 1, reminder: 'x' });
    elapsed = 3500;
    t.mock.timers.tick(3500);
    assert.equal(h.sent.length, 1);
    assert.equal((await h.call('wake_list')).timers[0].next_at, '2026-01-01T00:00:04.000Z');
    h.commit(0);
    elapsed = 4000;
    t.mock.timers.tick(500);
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1].message.details.due_at, '2026-01-01T00:00:04.000Z');
  } finally { h.stop(); }
});

test('interval repeats automatically; list and cancel use exact IDs and stop future firings', async () => {
  const h = harness();
  try {
    const job = await h.call('wake_every', { every_seconds: 1, reminder: 'Repeat action' });
    assert.equal(job.kind, 'every');
    assert.equal(job.status, 'registered');
    assert.deepEqual((await h.call('wake_list')).timers.map(j => [j.job_id, j.reminder]), [[job.job_id, 'Repeat action']]);
    await pause(1100);
    assert.equal(h.sent.length, 1);
    h.commit(0);
    await pause(1050);
    assert.equal(h.sent.length, 2, 'code must repeat without model rearm');
    assert.equal(Date.parse(h.sent[1].message.details.due_at) - Date.parse(h.sent[0].message.details.due_at), 1000);
    assert.deepEqual(h.sent[0].options, { triggerTurn: true, deliverAs: 'followUp' });
    const cancelled = await h.call('wake_cancel', { job_id: job.job_id });
    assert.equal(cancelled.status, 'cancelled_future_only');
    assert.deepEqual((await h.call('wake_list')).timers, []);
    await pause(1100);
    assert.equal(h.sent.length, 2);
  } finally { h.stop(); }
});

test('busy ticks coalesce to one unsent notice; cancellation drops it but not submitted work', async () => {
  const h = harness();
  try {
    const job = await h.call('wake_every', { every_seconds: 1, reminder: 'Repeat action' });
    h.emit('agent_start');
    await pause(3200);
    assert.ok(h.sent.length <= 1, 'busy work must not accumulate native follow-ups');
    h.emit('agent_end');
    assert.equal(h.sent.length, 1);
    await h.call('wake_cancel', { job_id: job.job_id });
    h.commit(0);
    h.emit('agent_end');
    await pause(1100);
    assert.equal(h.sent.length, 1);
  } finally { h.stop(); }
});

test('unknown cancellation is an error; validation and cancellation cannot release submitted capacity', async () => {
  const h = harness();
  try {
    await assert.rejects(h.call('wake_cancel', { job_id: 'unknown' }), /WAKEUPS_JOB_NOT_FOUND/);
    for (const value of [0, -1, 0.5, Infinity, 31536001]) {
      await assert.rejects(h.call('wake_every', { every_seconds: value, reminder: 'x' }), /WAKEUPS_INVALID/);
    }
    for (let i = 0; i < 32; i++) await h.call('wake_after', { delay_seconds: 1, reminder: 'x' });
    await pause(1100);
    assert.equal(h.sent.length, 32);
    await h.call('wake_cancel', { job_id: h.sent[0].message.details.job_id });
    await assert.rejects(h.call('wake_after', { delay_seconds: 1, reminder: 'x' }), /WAKEUPS_CAPACITY/);
    h.commit(0);
    await h.call('wake_after', { delay_seconds: 10, reminder: 'x' });
  } finally { h.stop(); }
});

test('unconfirmed native submission stays bounded, including asynchronous failures invisible to void API', async () => {
  const h = harness();
  try {
    await h.call('wake_every', { every_seconds: 1, reminder: 'x' });
    await pause(3200);
    assert.equal(h.sent.length, 1, 'without custom message_end no additional message can be submitted');
    h.commit(0);
    assert.equal(h.sent.length, 2, 'at most one coalesced pending notice follows commit');
  } finally { h.stop(); }
});

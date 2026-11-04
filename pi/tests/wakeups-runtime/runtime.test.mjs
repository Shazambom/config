import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import install from '../../agent/wakeups/runtime.mjs';
import { performance } from 'node:perf_hooks';

const definition = JSON.parse(readFileSync(new URL('../../agent/wakeups/contract.json', import.meta.url))).tools.find(tool => tool.name === 'wake_after');
const receipt = { managed: true, status: 'owned', sessionFile: join(tmpdir(), 'wakeups-unit-session'), generation: 'owner-a' };

function harness() {
  const handlers = new Map();
  const h = { replies: [receipt], sent: [], warnings: [], queries: 0, mode: 'tui' };
  const pi = {
    events: { emit(_name, { respond }) {
      h.queries++;
      if (h.brokenBus) throw new Error('synthetic failure');
      for (const value of h.replies) respond(value);
    } },
    on(name, callback) { handlers.set(name, callback); },
    registerTool(tool) { h.tool = tool; },
    sendMessage(message, options) { h.sent.push({ message, options }); },
  };
  install(pi, definition);
  h.emit = (name, event = {}) => handlers.get(name)?.(event);
  h.call = (seconds = 1) => h.tool.execute('call', { delay_seconds: seconds, reminder: 'Check tea' }, undefined, undefined,
    { mode: h.mode, ui: { notify: text => h.warnings.push(text) } });
  h.stop = () => h.emit('session_shutdown');
  h.emit('session_start');
  return h;
}

test('missing, ambiguous, malformed and non-owned admission cannot register', async () => {
  const h = harness();
  try {
    for (const replies of [[], [receipt, receipt], [{ status: 'owned' }],
      ...['pending', 'conflict', 'stopping', 'unprotected'].map(status => [{ managed: true, status }])]) {
      h.replies = replies;
      await assert.rejects(h.call(), /WAKEUPS_OWNERSHIP_REQUIRED/);
    }
    h.replies = [receipt];
    h.brokenBus = true;
    await assert.rejects(h.call(), /WAKEUPS_OWNERSHIP_REQUIRED/);
    assert.equal(h.sent.length, 0);
  } finally { h.stop(); }
});

test('print and JSON cannot promise a reminder after the caller exits', async () => {
  const h = harness();
  try {
    for (const mode of ['print', 'json']) {
      h.mode = mode;
      await assert.rejects(h.call(), /WAKEUPS_PERSISTENT_MODE_REQUIRED/);
    }
  } finally { h.stop(); }
});

test('an owned persistent RPC caller can register', async () => {
  const h = harness();
  try {
    h.mode = 'rpc';
    assert.equal((await h.call()).details.status, 'registered');
  } finally { h.stop(); }
});

test('fresh ownership is required at dispatch, for both identity fields', async () => {
  for (const changed of [{ ...receipt, generation: 'owner-b' }, { ...receipt, sessionFile: join(tmpdir(), 'wakeups-unit-other') }]) {
    const h = harness();
    try {
      await h.call();
      h.replies = [changed];
      await pause(1150);
      assert.equal(h.sent.length, 0, 'changed ownership must prevent the actual send');
      assert.ok(h.queries >= 2, 'dispatch must obtain a fresh admission snapshot');
      assert.equal(h.warnings.length, 1);
    } finally { h.stop(); }
  }
});

test('shutdown cancels real timers and rejects later registration', async () => {
  const h = harness();
  await h.call();
  h.stop();
  h.stop();
  await assert.rejects(h.call(), /WAKEUPS_OWNERSHIP_REQUIRED/);
  await pause(1150);
  assert.equal(h.sent.length, 0);
});

test('a restarted incarnation cannot deliver its predecessor timer', async () => {
  const h = harness();
  try {
    await h.call();
    h.stop();
    h.emit('session_start');
    const next = await h.call();
    await pause(1150);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].message.details.job_id, next.details.job_id);
    assert.deepEqual(h.sent[0].options, { triggerTurn: true, deliverAs: 'followUp' });
  } finally { h.stop(); }
});

test('30-day delay does not overflow into an immediate real callback', async t => {
  const h = harness();
  const delays = [];
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    delays.push(delay);
    return realSetTimeout(callback, delay, ...args);
  });
  try {
    const before = Date.now();
    const result = await h.call(30 * 24 * 60 * 60);
    assert.ok(Date.parse(result.details.next_at) >= before + 2_592_000_000);
    assert.equal(delays[0], 2_147_483_647, 'the real Node timer must receive a safe bounded chunk');
    await pause(100);
    assert.equal(delays.length, 1, 'long waits must not spin through overflow callbacks');
    assert.equal(h.sent.length, 0);
  } finally { h.stop(); }
});

test('relative wait ignores wall-clock jumps while actual elapsed time controls delivery', async t => {
  const h = harness();
  try {
    await h.call();
    const shifted = Date.now() + 365 * 24 * 60 * 60 * 1000;
    t.mock.method(Date, 'now', () => shifted);
    await pause(100);
    assert.equal(h.sent.length, 0);
    await pause(1050);
    assert.equal(h.sent.length, 1);
  } finally { h.stop(); }
});

test('30-day elapsed wait rechecks and completes across native timeout chunks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  const h = harness();
  try {
    await h.call(30 * 24 * 60 * 60);
    elapsed = 2_147_483_647;
    t.mock.timers.tick(elapsed);
    assert.equal(h.sent.length, 0);
    const rest = 2_592_000_000 - elapsed;
    elapsed += rest;
    t.mock.timers.tick(rest);
    assert.equal(h.sent.length, 1);
  } finally { h.stop(); }
});

test('submitted notices retain capacity until committed to Pi, without claiming acknowledgement', async () => {
  const h = harness();
  try {
    for (let n = 0; n < 32; n++) await h.call();
    await assert.rejects(h.call(), /WAKEUPS_CAPACITY_REACHED/);
    await pause(1150);
    assert.equal(h.sent.length, 32);
    await assert.rejects(h.call(), /WAKEUPS_CAPACITY_REACHED/);
    const message = { role: 'custom', ...h.sent[0].message };
    h.emit('message_end', { message });
    assert.equal((await h.call(30)).details.status, 'registered');
  } finally { h.stop(); }
});

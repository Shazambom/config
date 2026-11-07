// Installed CLI protocol needs Node; all schedules below use real wall/monotonic time.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const evidence = resolve(process.argv[2]); mkdirSync(evidence, { recursive: true, mode: 0o700 });
const candidate = resolve(process.argv[3] ?? join(repo, 'pi/agent/wakeups/index.ts'));
const contract = JSON.parse(readFileSync(join(repo, 'pi/tests/wakeups-sandbox/interface-v1.json')));
const run = (...args) => execFileSync('bash', [join(repo, 'pi/tests/lifecycle-lab/lab.sh'), ...args], { encoding: 'utf8', timeout: 60000 });
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const lines = p => existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const mono = () => Number(process.hrtime.bigint()) / 1e6;
const record = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const text = m => typeof m.content === 'string' ? m.content : (m.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
const calls = [
  ['repeat', 'wake_every', { every_seconds: 3, reminder: 'Keep this original recurring task' }],
  ['cancelled', 'wake_after', { delay_seconds: 20, reminder: 'Must never fire after cancellation' }],
  ['calendar', 'wake_cron', { expression: '* * * * *', timezone: 'UTC', reminder: 'Observe two real UTC minute boundaries' }],
  ['list', 'wake_list', {}],
];
let next = 0, id, work, failure;
const requests = [];
const receipts = new Map();
let cancelStage = 0;
let busyWindow;
const originalTask = 'Register recurring reminders once, list the timers, cancel only the one-shot, and preserve the original recurring task.';
const observations = () => lines(join(work, 'wake-observations.jsonl'));
function result(callId) {
  const message = observations().find(o => o.event.type === 'message_end' && o.event.message.role === 'toolResult' && o.event.message.toolCallId === callId)?.event.message;
  assert.ok(message && !message.isError, `${callId} must succeed: ${JSON.stringify(message)}`);
  return JSON.parse(text(message));
}
const server = createServer(async (req, res) => {
  if (req.url === '/health') { res.end('alive'); return; }
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push({ mono: mono(), body });
    appendFileSync(join(evidence, 'provider.jsonl'), JSON.stringify(requests.at(-1)) + '\n');
    let call;
    if (next < calls.length) call = calls[next++];
    else if (cancelStage === 0) { call = ['cancel-known', 'wake_cancel', { job_id: result('cancelled').job_id }]; cancelStage++; }
    else if (cancelStage === 1) { call = ['cancel-unknown', 'wake_cancel', { job_id: 'not-a-returned-job-id' }]; cancelStage++; }
    if (!call && !busyWindow) {
      // Keep an actual provider turn in flight across several interval deadlines.
      busyWindow = { start: mono() };
      const deadline = busyWindow.start + 11000;
      do { await pause(Math.max(1, Math.ceil(deadline - mono()))); } while (mono() < deadline);
      busyWindow.end = mono();
      record('busy-window.json', busyWindow);
    }
    const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: call[0], type: 'function', function: { name: call[1], arguments: JSON.stringify(call[2]) } }] } : { role: 'assistant', content: 'TIMER_ACK' };
    const base = { id: `timer-${requests.length}`, object: 'chat.completion.chunk', created: 0, model: 'offline' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [d, finish_reason] of [[delta, null], [{}, call ? 'tool_calls' : 'stop']]) res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: d, finish_reason }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (e) { failure ??= e; record('provider-error.json', { error: e.message }); res.destroy(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const until = async (predicate, ms, label) => {
  const end = mono() + ms;
  while (!predicate() && !failure && mono() < end) await pause(50);
  if (failure) throw failure;
  assert.ok(predicate(), label);
};
try {
  const installed = JSON.parse(run('resolve')); record('installed-cli.json', installed);
  record('case.json', { candidate, scope: 'real intervals, cron, cancellation and busy coalescing' });
  const wrapper = join(evidence, 'candidate.mjs');
  writeFileSync(wrapper, `process.argv = process.argv.flatMap(a => a === '--no-tools' ? ['--no-builtin-tools', '--tools', ${JSON.stringify(contract.tools.map(t => t.name).join(','))}] : [a]);\nawait import(${JSON.stringify(pathToFileURL(installed.cli).href)});\n`); chmodSync(wrapper, 0o700);
  const created = JSON.parse(run('create', '--cli', wrapper, '--extension', join(repo, 'pi/agent/lifecycle/session-lifecycle.ts'), '--extension', join(repo, 'pi/tests/wakeups-runtime/observe.ts'), '--extension', candidate));
  ({ id, evidence: work } = created); record('lab.json', created);
  const modelsPath = join(work, 'agent/models.json'); const models = json(modelsPath);
  models.providers.lifecycle.baseUrl = `http://127.0.0.1:${server.address().port}/v1`; writeFileSync(modelsPath, JSON.stringify(models));
  assert.deepEqual(json(join(work, 'agent/auth.json')), {});
  run('attach', id, 'terminal'); run('open', id, 'wake');
  await until(() => observations().some(o => o.event.type === 'session_start'), 15000, 'CLI startup');
  assert.ok(observations().some(o => o.admission?.status === 'owned'), 'real guard admission');
  run('type', id, 'wake', originalTask); run('key', id, 'wake', 'Enter');
  await until(() => observations().some(o => o.event.type === 'message_end' && o.event.message.toolCallId === 'repeat'), 15000, 'first tool result');
  receipts.set('repeat', result('repeat')); // Fail promptly for a missing operation, not a calendar timeout.
  await until(() => cancelStage === 2 && observations().some(o => o.event.type === 'agent_settled'), 15000, 'registration and cancellation settle');
  for (const name of ['cancelled', 'calendar', 'list', 'cancel-known']) receipts.set(name, result(name));
  assert.equal(receipts.get('repeat').kind, 'every'); assert.equal(receipts.get('calendar').kind, 'cron');
  assert.equal(receipts.get('cancel-known').status, 'cancelled_future_only');
  const listed = receipts.get('list');
  const jobs = listed.timers;
  assert.ok(Array.isArray(jobs), 'list returns active jobs');
  assert.deepEqual(jobs.map(j => j.job_id).sort(), ['repeat', 'cancelled', 'calendar'].map(n => receipts.get(n).job_id).sort());
  // UTC is explicit in the provider call; next_at and delivered boundaries prove its execution.
  const cron = jobs.find(j => j.job_id === receipts.get('calendar').job_id);
  assert.ok(Number.isFinite(Date.parse(cron.next_at)));
  const unknown = observations().find(o => o.event.type === 'message_end' && o.event.message.toolCallId === 'cancel-unknown')?.event.message;
  assert.ok(unknown?.isError, 'unknown ID returns an ordinary tool error');
  const events = () => {
    const found = [];
    for (const request of requests) for (const m of request.body.messages ?? []) {
      if (m.role !== 'user') continue;
      const s = text(m); const start = s.indexOf('{'), end = s.lastIndexOf('}');
      if (start < 0) continue;
      try { const e = JSON.parse(s.slice(start, end + 1)); if (e.kind === 'wake_due' && !found.some(f => f.job_id === e.job_id && f.due_at === e.due_at)) found.push(e); } catch {}
    }
    return found;
  };
  await until(() => events().filter(e => e.job_id === receipts.get('calendar').job_id).length >= 2, 130000, 'two autonomous real minutely cron ticks');
  const wakes = events(); record('events.json', wakes);
  const committed = observations().filter(o => o.event.type === 'message_end' && o.event.message.role === 'custom' && o.event.message.details?.kind === 'wake_due').map(o => o.event.message.details);
  assert.equal(new Set(committed.map(e => `${e.job_id}/${e.due_at}`)).size, committed.length, 'no duplicate saved delivery for a timer occurrence');
  assert.ok(busyWindow.end - busyWindow.start >= 11000, 'actual provider turn stayed busy across at least three ticks');
  const duringBusy = requests.filter(r => r.mono > busyWindow.start && r.mono < busyWindow.end);
  assert.equal(duringBusy.length, 0, 'steering must not interrupt the in-flight provider request');
  const following = requests.find(r => r.mono > busyWindow.end);
  assert.ok(following?.body.messages.some(m => m.role === 'user' && text(m).includes(originalTask)), 'original user task survives follow-up');
  // The submitted first tick cannot be recalled. Later ticks share one pending slot.
  // At the boundary, message_end releases that slot and flushes only the latest tick.
  const immediate = observations().filter(o => o.event.type === 'message_end' && o.event.message.role === 'custom' && o.event.message.details?.job_id === receipts.get('repeat').job_id && o.mono >= busyWindow.end && o.mono < busyWindow.end + 500);
  assert.equal(immediate.length, 2, 'one submitted plus one coalesced pending tick, not a missed-tick backlog');
  assert.ok(Date.parse(immediate[1].event.message.details.due_at) - Date.parse(immediate[0].event.message.details.due_at) >= 6000,
    'intermediate ticks are coalesced rather than replayed');
  const repeating = wakes.filter(e => e.job_id === receipts.get('repeat').job_id);
  assert.ok(repeating.length >= 3, 'at least three automatic interval events without rearming');
  assert.ok(repeating.every(e => e.reminder === calls[0][2].reminder && e.schedule_kind === 'every'));
  assert.ok(!wakes.some(e => e.job_id === receipts.get('cancelled').job_id), 'cancelled one-shot never delivered');
  const calendar = wakes.filter(e => e.job_id === receipts.get('calendar').job_id);
  assert.equal(Date.parse(calendar[1].due_at) - Date.parse(calendar[0].due_at), 60000);
  assert.ok(calendar.every(e => Date.parse(e.due_at) % 60000 === 0 && Date.parse(e.observed_at) >= Date.parse(e.due_at)));
  const declarations = requests[0].body.tools.map(t => t.function);
  assert.deepEqual(declarations.map(t => t.name).sort(), contract.tools.map(t => t.name).sort(), 'all six and no builtin tools');
  for (const expected of contract.tools) assert.deepEqual(declarations.find(t => t.name === expected.name).parameters, expected.parameters);
  const toolCalls = observations().filter(o => o.event.type === 'tool_call');
  for (const name of ['wake_every', 'wake_after', 'wake_cron']) assert.equal(toolCalls.filter(o => o.event.toolName === name).length, 1, `no rearm of ${name}`);
  const entries = lines(join(work, 'histories/wake.jsonl')); const byId = new Map(entries.map(e => [e.id, e]));
  let leaf = observations().at(-1).leaf; const branch = [];
  while (leaf) { const entry = byId.get(leaf); assert.ok(entry, 'saved active parent exists'); branch.push(entry); leaf = entry.parentId; }
  assert.ok(branch.some(e => e.message?.role === 'assistant' && text(e.message) === 'TIMER_ACK'), 'ACK saved on active branch');
  const status = JSON.parse(run('status', id)); record('before-cleanup.json', status); assert.ok(status.conversations.wake.alive);
  assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).text(), 'alive');
  record('result.json', { pass: true, scope: 'normal CLI intervals, cron, list, selective cancellation', untested: ['reload/new', 'shell', 'guard denial', 'RPC/print'] });
} catch (e) { failure = e; record('result.json', { pass: false, assertion: e.message, stack: e.stack }); }
finally {
  await new Promise(r => server.close(r));
  if (id) { try { record('observations.json', observations()); record('cleanup.json', JSON.parse(run('cleanup', id))); record('after-cleanup.json', JSON.parse(run('status', id))); } catch (e) { failure ??= e; record('cleanup-error.json', { error: e.message }); } }
}
console.log(`Evidence: ${evidence}\nLab: ${work ?? 'not created'}`);
if (failure) { console.error(failure.message); process.exitCode = 1; }

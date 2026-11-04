// Real installed-CLI shell acceptance. The provider only requests tools and acknowledges notices.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync, mkdirSync, renameSync } from 'node:fs';
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
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
// Every descendant is finite and private. No user file, external PID, or fake termination.
const cases = [
  { name: 'zero', script: 'exit 0\n', termination: { exit_code: 0 } },
  { name: 'numeric-137', script: 'exit 137\n', termination: { exit_code: 137 } },
  { name: 'seven', script: 'sleep 2\nexit 7\n', termination: { exit_code: 7 } },
  { name: 'signal', script: 'sleep 2\nkill -TERM $$\n', termination: { signal: 'SIGTERM' } },
  { name: 'text-done', script: 'printf textDone\nsleep 4\nprintf trailing-out\nprintf trailing-err >&2\nexit 7\n', termination: { exit_code: 7 }, minimumMs: 4000 },
  { name: 'tails', script: "i=0\nwhile [ \"$i\" -lt 5000 ]; do printf x; printf y >&2; i=$((i+1)); done\nprintf OUT-END\nprintf ERR-END >&2\n", termination: { exit_code: 0 } },
  { name: 'held-pipe', script: '(sleep 12) &\nprintf direct-done\nexit 0\n', termination: { exit_code: 0 }, maximumMs: 10000 },
];
const requests = []; let next = 0, id, work, failure, injectLaunchFailure = false, movedCwd;
const observations = () => lines(join(work, 'wake-observations.jsonl'));
function toolResult(name) {
  const message = observations().find(o => o.event.type === 'message_end' && o.event.message.role === 'toolResult' && o.event.message.toolCallId === name)?.event.message;
  assert.ok(message && !message.isError, `${name} watch_shell must launch: ${JSON.stringify(message)}`);
  return JSON.parse(text(message));
}
function events() {
  const found = [];
  for (const request of requests) for (const m of request.body.messages ?? []) {
    if (m.role !== 'user') continue;
    const s = text(m), start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start < 0) continue;
    try { const e = JSON.parse(s.slice(start, end + 1)); if (e.kind === 'shell_exit' && !found.some(f => f.event.process_id === e.process_id)) found.push({ event: e, mono: request.mono }); } catch {}
  }
  return found;
}
const server = createServer(async (req, res) => {
  if (req.url === '/health') { res.end('alive'); return; }
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push({ mono: mono(), body });
    appendFileSync(join(evidence, 'provider.jsonl'), JSON.stringify(requests.at(-1)) + '\n');
    const fixture = injectLaunchFailure ? { name: 'launch-failure' } : cases[next++];
    injectLaunchFailure = false;
    const delta = fixture ? { role: 'assistant', tool_calls: [{ index: 0, id: fixture.name, type: 'function', function: { name: 'watch_shell', arguments: JSON.stringify({ command: `exec bash ${quote(join(work, fixture.name + '.sh'))}`, on_exit: `Report actual termination of ${fixture.name}` }) } }] } : { role: 'assistant', content: 'SHELL_ACK' };
    const base = { id: `shell-${requests.length}`, object: 'chat.completion.chunk', created: 0, model: 'offline' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [d, finish_reason] of [[delta, null], [{}, fixture ? 'tool_calls' : 'stop']]) res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: d, finish_reason }] })}\n\n`);
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
  record('case.json', { candidate, scope: 'real foreground shell exits, publication order and launch failure' });
  const wrapper = join(evidence, 'candidate.mjs');
  writeFileSync(wrapper, `process.argv = process.argv.flatMap(a => a === '--no-tools' ? ['--no-builtin-tools', '--tools', ${JSON.stringify(contract.tools.map(t => t.name).join(','))}] : [a]);\nawait import(${JSON.stringify(pathToFileURL(installed.cli).href)});\n`); chmodSync(wrapper, 0o700);
  const created = JSON.parse(run('create', '--cli', wrapper, '--extension', join(repo, 'pi/agent/lifecycle/session-lifecycle.ts'), '--extension', join(repo, 'pi/tests/wakeups-runtime/observe.ts'), '--extension', candidate));
  ({ id, evidence: work } = created); record('lab.json', created);
  for (const fixture of cases) writeFileSync(join(work, fixture.name + '.sh'), fixture.script, { mode: 0o700 });
  const modelsPath = join(work, 'agent/models.json'); const models = json(modelsPath);
  models.providers.lifecycle.baseUrl = `http://127.0.0.1:${server.address().port}/v1`; writeFileSync(modelsPath, JSON.stringify(models));
  assert.deepEqual(json(join(work, 'agent/auth.json')), {});
  run('attach', id, 'terminal'); run('open', id, 'wake');
  await until(() => observations().some(o => o.event.type === 'session_start'), 15000, 'CLI startup');
  assert.ok(observations().some(o => o.admission?.status === 'owned'), 'real guard admission');
  run('type', id, 'wake', 'Launch the private foreground fixtures and report only actual shell termination, never output text as completion.'); run('key', id, 'wake', 'Enter');
  await until(() => observations().some(o => o.event.type === 'message_end' && o.event.message.toolCallId === 'zero'), 15000, 'first shell result');
  toolResult('zero'); // Immediate RED when operation is absent.
  await until(() => events().length === cases.length, 20000, 'all actual shell exit events delivered');
  const exits = events(); record('events.json', exits);
  const declarations = requests[0].body.tools.map(t => t.function);
  assert.deepEqual(declarations.map(t => t.name).sort(), contract.tools.map(t => t.name).sort(), 'six tools only');
  for (const fixture of cases) {
    const receipt = toolResult(fixture.name); assert.equal(receipt.status, 'running'); assert.ok(receipt.process_id);
    const delivered = exits.find(e => e.event.process_id === receipt.process_id); assert.ok(delivered, fixture.name);
    const event = delivered.event;
    assert.deepEqual(event.termination, fixture.termination, `${fixture.name}: actual termination`);
    assert.equal(event.on_exit, `Report actual termination of ${fixture.name}`);
    for (const stream of ['stdout', 'stderr']) assert.ok(Buffer.byteLength(event[stream + '_tail']) <= 4096, 'bounded separate tails');
    const start = observations().find(o => o.event.type === 'tool_call' && o.event.toolCallId === fixture.name);
    if (fixture.minimumMs) assert.ok(delivered.mono - start.mono >= fixture.minimumMs, 'textDone is not termination');
    if (fixture.maximumMs) assert.ok(delivered.mono - start.mono < fixture.maximumMs, 'held pipes must not defer exit until descendant finishes');
    if (fixture.name === 'zero' || fixture.name === 'seven' || fixture.name === 'signal') { assert.equal(event.stdout_tail, ''); assert.equal(event.stderr_tail, ''); }
    if (fixture.name === 'text-done') { assert.equal(event.stdout_tail, 'textDonetrailing-out'); assert.equal(event.stderr_tail, 'trailing-err'); }
    if (fixture.name === 'tails') {
      assert.ok(event.stdout_tail.endsWith('OUT-END')); assert.ok(event.stderr_tail.endsWith('ERR-END'));
      assert.equal(event.stdout_dropped_bytes, 5007 - Buffer.byteLength(event.stdout_tail));
      assert.equal(event.stderr_dropped_bytes, 5007 - Buffer.byteLength(event.stderr_tail));
    }
    assert.equal(event.output_incomplete, fixture.name === 'held-pipe');
  }
  await until(() => observations().some(o => o.event.type === 'agent_settled') && observations().at(-1).idle, 5000, 'final settlement');
  const entries = lines(join(work, 'histories/wake.jsonl')); const byId = new Map(entries.map(e => [e.id, e]));
  let leaf = observations().at(-1).leaf; const branch = [];
  while (leaf) { const entry = byId.get(leaf); assert.ok(entry, 'saved active parent exists'); branch.push(entry); leaf = entry.parentId; }
  assert.ok(branch.some(e => e.message?.role === 'assistant' && text(e.message) === 'SHELL_ACK'), 'saved active-branch acknowledgement');
  const chronological = branch.toReversed();
  for (const fixture of cases) {
    const receipt = toolResult(fixture.name);
    const receiptIndex = chronological.findIndex(e => e.message?.role === 'toolResult' && e.message.toolCallId === fixture.name);
    const notices = chronological.filter(e => e.type === 'custom_message' && e.details?.process_id === receipt.process_id);
    assert.equal(notices.length, 1, `${fixture.name}: exactly one saved exit notice`);
    const noticeIndex = chronological.indexOf(notices[0]);
    assert.ok(receiptIndex >= 0 && noticeIndex > receiptIndex, `${fixture.name}: saved receipt precedes exit notice`);
  }
  // A nonexistent private cwd produces a real OS launch error, not a fabricated tool error.
  const actor = json(join(work, 'actors/pi-wake.json'));
  assert.ok(actor.cwd.startsWith(join(work, 'instances') + '/'), 'only the private fixture cwd may move');
  movedCwd = actor.cwd; renameSync(movedCwd, movedCwd + '.launch-failure');
  injectLaunchFailure = true;
  run('type', id, 'wake', 'Launch one command with the unavailable private working directory'); run('key', id, 'wake', 'Enter');
  await until(() => observations().some(o => o.event.type === 'message_end' && o.event.message.toolCallId === 'launch-failure'), 10000, 'actual OS launch failure result');
  renameSync(movedCwd + '.launch-failure', movedCwd); movedCwd = undefined;
  const failed = observations().find(o => o.event.type === 'message_end' && o.event.message.toolCallId === 'launch-failure').event.message;
  assert.ok(failed.isError && text(failed).includes('LAUNCH_FAILED'), 'ordinary safe launch failure');
  assert.ok(!failed.details?.process_id, 'failure gives no process handle');
  await pause(2000);
  assert.equal(events().length, cases.length, 'launch failure creates no later exit event');
  const status = JSON.parse(run('status', id)); record('before-cleanup.json', status); assert.ok(status.conversations.wake.alive);
  assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).text(), 'alive');
  // Finite held-pipe descendant has ended before inventory cleanup; no broad PID signals.
  await pause(12500);
  record('result.json', { pass: true, untested: ['root-death cleanup', 'unrelated sentinel', 'supervision loss'] });
} catch (e) { failure = e; record('result.json', { pass: false, assertion: e.message, stack: e.stack }); }
finally {
  if (movedCwd) renameSync(movedCwd + '.launch-failure', movedCwd);
  await new Promise(r => server.close(r));
  if (id) { try { record('observations.json', observations()); record('cleanup.json', JSON.parse(run('cleanup', id))); record('after-cleanup.json', JSON.parse(run('status', id))); } catch (e) { failure ??= e; record('cleanup-error.json', { error: e.message }); } }
}
console.log(`Evidence: ${evidence}\nLab: ${work ?? 'not created'}`);
if (failure) { console.error(failure.message); process.exitCode = 1; }

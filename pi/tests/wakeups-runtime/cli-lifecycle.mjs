// Exercise native /reload and /new; the observer never performs lifecycle transitions.
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
const requests = []; let id, work, failure, phase = 'reload', step = 0;
const observations = () => lines(join(work, 'wake-observations.jsonl'));
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push({ mono: mono(), phase, body });
    appendFileSync(join(evidence, 'provider.jsonl'), JSON.stringify(requests.at(-1)) + '\n');
    const call = step++ === 0;
    const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: phase, type: 'function', function: { name: 'wake_after', arguments: JSON.stringify({ delay_seconds: 6, reminder: `Discard old ${phase} incarnation` }) } }] } : { role: 'assistant', content: `REGISTERED_${phase}` };
    const base = { id: `lifecycle-${requests.length}`, object: 'chat.completion.chunk', created: 0, model: 'offline' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [d, finish_reason] of [[delta, null], [{}, call ? 'tool_calls' : 'stop']]) res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: d, finish_reason }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (e) { failure ??= e; res.destroy(); }
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
  record('case.json', { candidate, scope: 'native reload/new and ambiguous guard denial' });
  const wrapper = join(evidence, 'candidate.mjs');
  writeFileSync(wrapper, `process.argv = process.argv.flatMap(a => a === '--no-tools' ? ['--no-builtin-tools', '--tools', ${JSON.stringify(contract.tools.map(t => t.name).join(','))}] : [a]);\nawait import(${JSON.stringify(pathToFileURL(installed.cli).href)});\n`); chmodSync(wrapper, 0o700);
  const created = JSON.parse(run('create', '--cli', wrapper, '--extension', join(repo, 'pi/agent/lifecycle/session-lifecycle.ts'), '--extension', join(repo, 'pi/tests/wakeups-runtime/observe.ts'), '--extension', join(repo, 'pi/tests/wakeups-runtime/cli-deny.ts'), '--extension', candidate));
  ({ id, evidence: work } = created); record('lab.json', created);
  const modelsPath = join(work, 'agent/models.json'); const models = json(modelsPath);
  models.providers.lifecycle.baseUrl = `http://127.0.0.1:${server.address().port}/v1`; writeFileSync(modelsPath, JSON.stringify(models));
  assert.deepEqual(json(join(work, 'agent/auth.json')), {});
  run('attach', id, 'terminal'); run('open', id, 'wake');
  await until(() => observations().some(o => o.event.type === 'session_start'), 15000, 'CLI startup');
  for (const command of ['reload', 'new']) {
    phase = command; step = 0;
    const before = requests.length, observationStart = observations().length;
    assert.ok(observations().at(-1).admission?.status === 'owned', 'guard owned before registration');
    run('type', id, 'wake', `Schedule a reminder then discard it by ${command}`); run('key', id, 'wake', 'Enter');
    await until(() => requests.length === before + 2 && observations().slice(observationStart).some(o => o.event.type === 'agent_settled'), 15000, `${command} registration settled`);
    const result = observations().slice(observationStart).find(o => o.event.type === 'message_end' && o.event.message.toolCallId === command)?.event.message;
    assert.ok(result && !result.isError, 'real successful registration'); assert.equal(JSON.parse(text(result)).status, 'registered');
    const registered = observations().find(o => o.event.type === 'tool_call' && o.event.toolCallId === command);
    const old = observations().at(-1), starts = observations().filter(o => o.event.type === 'session_start').length;
    run('type', id, 'wake', `/${command}`); run('key', id, 'wake', 'Enter');
    await until(() => observations().filter(o => o.event.type === 'session_start').length > starts, 15000, `native /${command} session_start`);
    const fresh = observations().at(-1);
    if (command === 'new') assert.notEqual(fresh.sessionFile, old.sessionFile, 'native new changes session identity');
    assert.ok(mono() < registered.mono + 6000, 'transition must precede deadline');
    while (mono() < registered.mono + 8500) await pause(50);
    assert.equal(requests.length, before + 2, `/${command} must discard unsent old job`);
    assert.ok(!observations().slice(observationStart).some(o => o.event.message?.customType === 'wakeups'), 'no stale notice even without a model turn');
    const status = JSON.parse(run('status', id)); record(`after-${command}.json`, status); assert.ok(status.conversations.wake.alive, 'CLI remains live');
    // A real fresh task proves the reset CLI and loopback transport are still responsive.
    run('type', id, 'wake', `Confirm fresh ${command} session`); run('key', id, 'wake', 'Enter');
    await until(() => requests.length === before + 3 && observations().at(-1).event.type === 'agent_settled', 10000, 'fresh user task roundtrip');
    const active = observations().at(-1);
    const entries = lines(active.sessionFile), byId = new Map(entries.map(e => [e.id, e]));
    const branch = []; let leaf = active.leaf;
    while (leaf) { const entry = byId.get(leaf); assert.ok(entry, 'active ancestry exists'); branch.push(entry); leaf = entry.parentId; }
    assert.ok(branch.some(e => e.message?.role === 'user' && text(e.message).includes(`Confirm fresh ${command} session`)), 'fresh task saved on active branch');
  }
  phase = 'guard-lost'; step = 0;
  const before = requests.length, observationStart = observations().length;
  run('type', id, 'wake', 'Schedule a reminder before admission is lost'); run('key', id, 'wake', 'Enter');
  await until(() => requests.length === before + 2 && observations().at(-1).event.type === 'agent_settled', 15000, 'guard-loss registration settles');
  const receipt = observations().slice(observationStart).find(o => o.event.type === 'message_end' && o.event.message.toolCallId === phase)?.event.message;
  assert.ok(receipt && !receipt.isError, 'genuine guard allowed initial job');
  const start = observations().slice(observationStart).find(o => o.event.type === 'tool_call');
  writeFileSync(join(work, 'deny-wakeup-admission'), 'private ambiguous admission injection\n');
  while (mono() < start.mono + 8500) await pause(50);
  assert.ok(lines(join(work, 'denied-admissions.jsonl')).length > 0, 'admission fault actually observed');
  assert.equal(requests.length, before + 2, 'fresh ambiguous admission blocks old job dispatch');
  assert.ok(!observations().slice(observationStart).some(o => o.event.message?.customType === 'wakeups'), 'no stale submitted notice');
  phase = 'guard-denied'; step = 0;
  run('type', id, 'wake', 'Attempt registration with ambiguous admission'); run('key', id, 'wake', 'Enter');
  await until(() => requests.length === before + 4 && observations().at(-1).event.type === 'agent_settled', 15000, 'denied registration settles normally');
  const denied = observations().find(o => o.event.type === 'message_end' && o.event.message.toolCallId === phase)?.event.message;
  assert.ok(denied?.isError && text(denied).includes('WAKEUPS_OWNERSHIP_REQUIRED'), 'ambiguous ownership is an ordinary registration error');
  const finalStatus = JSON.parse(run('status', id)); record('after-denial.json', finalStatus); assert.ok(finalStatus.conversations.wake.alive);
  record('result.json', { pass: true, scope: 'native normal-mode reload/new, guard loss and ambiguous-admission registration denial' });
} catch (e) { failure = e; record('result.json', { pass: false, assertion: e.message, stack: e.stack }); }
finally {
  await new Promise(r => server.close(r));
  if (id) { try { record('observations.json', observations()); record('cleanup.json', JSON.parse(run('cleanup', id))); record('after-cleanup.json', JSON.parse(run('status', id))); } catch (e) { failure ??= e; record('cleanup-error.json', { error: e.message }); } }
}
console.log(`Evidence: ${evidence}\nLab: ${work ?? 'not created'}`);
if (failure) { console.error(failure.message); process.exitCode = 1; }

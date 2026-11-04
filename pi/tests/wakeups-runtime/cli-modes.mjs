// Node is required for the installed CLI's HTTP/SSE protocol and asynchronous coordinator.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const evidence = resolve(process.argv[2]);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const mode = process.argv[4] ?? 'rpc';
assert.ok(['rpc', 'print'].includes(mode));
const toolNames = JSON.parse(readFileSync(join(repo, 'pi/tests/wakeups-sandbox/interface-v1.json'))).tools.map(t => t.name);
const lab = join(repo, 'pi/tests/lifecycle-lab/lab.sh');
const run = (...args) => execFileSync('bash', [lab, ...args], { encoding: 'utf8', timeout: 60000 });
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const lines = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const mono = () => Number(process.hrtime.bigint()) / 1e6;
const record = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const delay = 6;
const reminder = `WAKE_REMINDER_${randomUUID()}`;
const args = { delay_seconds: delay, reminder };
const requests = [];
let id, work, error;
const server = createServer(async (req, res) => {
  if (req.url === '/health') { res.end('alive'); return; }
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ mono: mono(), wall: Date.now(), body });
    appendFileSync(join(evidence, 'provider.jsonl'), JSON.stringify(requests.at(-1)) + '\n');
    const first = requests.length === 1;
    if (mode === 'print' && first) await pause(2000); // Let lab inventory record the real one-shot process.
    // This provider never creates a wake. Only a subsequent real CLI request can receive ACK.
    const delta = first
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'wake-call', type: 'function', function: { name: 'wake_after', arguments: JSON.stringify(args) } }] }
      : { role: 'assistant', content: requests.length === 2 ? 'REGISTERED_WAITING' : 'WAKE_ACK' };
    const base = { id: `wake-${requests.length}`, object: 'chat.completion.chunk', created: 0, model: 'offline' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (e) { record('provider-error.json', { error: String(e) }); res.destroy(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  const resolved = JSON.parse(run('resolve'));
  record('installed-cli.json', resolved);
  const wrapper = join(evidence, 'candidate.mjs');
  writeFileSync(wrapper, `import { appendFileSync } from 'node:fs';\nconst originalWrite = process.stdout.write.bind(process.stdout);\nprocess.stdout.write = function(chunk, ...args) { if (!process.argv.includes('--version')) appendFileSync(${JSON.stringify(join(evidence, 'stdout.jsonl'))}, chunk); return originalWrite(chunk, ...args); };\nprocess.argv = process.argv.flatMap(a => a === '--no-tools' ? ['--no-builtin-tools', '--tools', ${JSON.stringify(toolNames.join(','))}] : [a]);\nprocess.argv.push(...${JSON.stringify(mode === 'rpc' ? ['--mode', 'rpc'] : ['--print', '--mode', 'json', `Schedule ${reminder} after ${delay} seconds`])});\nawait import(${JSON.stringify(pathToFileURL(resolved.cli).href)});\n`);
  chmodSync(wrapper, 0o700);
  const extensions = ['--extension', join(repo, 'pi/agent/lifecycle/session-lifecycle.ts'), '--extension', join(here, 'observe.ts')];
  const candidate = resolve(process.argv[3] ?? join(repo, 'pi/agent/wakeups/index.ts'));
  if (existsSync(candidate)) extensions.push('--extension', candidate);
  record('case.json', { args, candidate, candidatePresent: existsSync(candidate), scope: `actual ${mode} CLI mode` });
  const created = JSON.parse(run('create', '--cli', wrapper, ...extensions));
  ({ id, evidence: work } = created); record('lab.json', created);
  // Change only this private lab's provider URL, never the shared fixture.
  const modelsPath = join(work, 'agent/models.json');
  const models = json(modelsPath); models.providers.lifecycle.baseUrl = `${url}/v1`;
  writeFileSync(modelsPath, JSON.stringify(models));
  assert.deepEqual(json(join(work, 'agent/auth.json')), {});
  run('attach', id, 'terminal'); run('open', id, 'wake');
  const until = async (predicate, ms, label) => {
    const end = mono() + ms;
    while (!predicate() && mono() < end) await pause(50);
    assert.ok(predicate(), `INFRA: ${label}`);
  };
  const observations = () => lines(join(work, 'wake-observations.jsonl'));
  await until(() => observations().some(o => o.event.type === 'session_start'), 15000, 'CLI startup with unknown allowed tool');
  assert.ok(observations().some(o => o.admission?.status === 'owned'), 'INFRA: real lifecycle admission');
  if (mode === 'rpc') {
    run('type', id, 'wake', JSON.stringify({ id: 'initial-task', type: 'prompt', message: `Schedule ${reminder} after ${delay} seconds` })); run('key', id, 'wake', 'Enter');
  }
  await until(() => requests.length >= 2 && observations().some(o => o.event.type === 'agent_settled'), 15000, 'real tool roundtrip and settlement');
  // No input after the initial Enter. Observe beyond due plus a duplicate-delivery window.
  const end = requests[0].mono + delay * 1000 + 4000;
  while (mono() < end) await pause(50);
  record('before-cleanup.json', JSON.parse(run('status', id)));
  assert.equal(await (await fetch(`${url}/health`)).text(), 'alive');
  record('provider-liveness.json', { listening: server.listening, requests: requests.length });
  writeFileSync(join(evidence, 'screen.txt'), run('screen', id, 'wake'));
  const obs = observations(); record('observations.json', obs);
  assert.equal(json(join(evidence, 'before-cleanup.json')).conversations.wake.alive, mode === 'rpc', 'RPC stays alive; print exits');
  const messages = obs.filter(o => o.event.type === 'message_end').map(o => o.event.message);
  const result = messages.find(m => m.role === 'toolResult' && m.toolCallId === 'wake-call');
  if (mode === 'rpc') assert.ok(result && !result.isError, `wake_after must return a successful real registration receipt; got ${JSON.stringify(result)}`);
  else assert.ok(result?.isError && result.content.some(c => c.text?.includes('WAKEUPS_PERSISTENT_MODE_REQUIRED')), 'print must reject timer registration');
  const declaration = requests[0].body.tools?.find(t => t.function?.name === 'wake_after')?.function;
  assert.ok(declaration, 'wake_after must be declared to the provider');
  const contract = json(join(repo, 'pi/tests/wakeups-sandbox/interface-v1.json')).tools[0];
  assert.deepEqual(declaration.parameters, contract.parameters, 'frozen wake_after parameter schema');
  assert.deepEqual(requests[0].body.tools.map(t => t.function.name).sort(), [...toolNames].sort(), 'all six tools, no builtin tools');
  const call = messages.flatMap(m => m.content ?? []).find(c => c.type === 'toolCall');
  assert.equal(call.name, 'wake_after'); assert.deepEqual(call.arguments, args);
  const wire = lines(join(evidence, 'stdout.jsonl'));
  if (mode === 'rpc') {
  assert.ok(wire.some(e => e.type === 'response' && e.id === 'initial-task' && e.success), 'actual correlated RPC prompt response');
  assert.ok(wire.some(e => e.type === 'message_end' && e.message?.role === 'assistant' && e.message.content?.some(c => c.text === 'WAKE_ACK')), 'wake ACK on actual RPC stdout');
  const receipt = JSON.parse(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  assert.equal(receipt.status, 'registered'); assert.equal(receipt.kind, 'after');
  assert.ok(receipt.job_id && Number.isFinite(Date.parse(receipt.next_at)));
  const toolStart = obs.find(o => o.event.type === 'tool_call' && o.event.toolCallId === 'wake-call');
  const settled = obs.find(o => o.event.type === 'agent_settled');
  assert.ok(settled.idle && !settled.pending, 'agent_settled must observe idle with no pending messages');
  assert.ok(settled.mono < toolStart.mono + delay * 1000, 'idle must precede elapsed deadline');
  assert.equal(requests.length, 3, 'exactly one autonomous wake provider request');
  assert.ok(requests[2].mono - toolStart.mono >= delay * 1000, 'real wake must not arrive early');
  const newMessages = requests[2].body.messages.slice(requests[1].body.messages.length);
  const eventText = newMessages.filter(m => m.role === 'user').map(m =>
    typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
  ).join('\n');
  // Accept surrounding presentation text, but compare parsed fields, not substrings.
  const start = eventText.indexOf('{');
  const finish = eventText.lastIndexOf('}');
  const wake = JSON.parse(eventText.slice(start, finish + 1));
  assert.equal(wake.kind, 'wake_due');
  assert.equal(wake.job_id, receipt.job_id);
  assert.equal(wake.reminder, reminder);
  assert.equal(wake.schedule_kind, 'after');
  assert.ok(Number.isFinite(Date.parse(wake.due_at)) && Number.isFinite(Date.parse(wake.observed_at)));
  assert.ok(Date.parse(wake.observed_at) >= Date.parse(wake.due_at), 'event must not claim early delivery');
  const entries = lines(join(work, 'histories/wake.jsonl'));
  const byId = new Map(entries.map(e => [e.id, e]));
  const branch = []; let leaf = obs.at(-1).leaf;
  while (leaf) { const entry = byId.get(leaf); assert.ok(entry, 'active branch parent exists'); branch.push(entry); leaf = entry.parentId; }
  assert.equal(branch.filter(e => e.message?.role === 'assistant' && e.message.content?.some(c => c.text === 'WAKE_ACK')).length, 1, 'saved active-parent-chain WAKE_ACK exactly once');
  } else {
    assert.equal(requests.length, 2, 'print has no autonomous wake request');
    assert.ok(wire.some(e => e.type === 'session'), 'actual print/JSON session header');
    assert.ok(wire.some(e => e.type === 'message_end' && e.message?.role === 'toolResult' && e.message.isError), 'ordinary print tool error on stdout');
  }
  record('result.json', { pass: true, mode });
} catch (e) {
  error = e; record('result.json', { pass: false, assertion: e.message, stack: e.stack });
} finally {
  await new Promise(resolve => server.close(resolve));
  record('provider-closed.json', { listening: server.listening });
  if (id) {
    try { record('cleanup.json', JSON.parse(run('cleanup', id))); record('after-cleanup.json', JSON.parse(run('status', id))); }
    catch (e) { record('cleanup-error.json', { error: String(e) }); error = e; }
  }
}
console.log(`Evidence: ${evidence}\nLab: ${work ?? 'not created'}`);
if (error) { console.error(error.message); process.exitCode = 1; }

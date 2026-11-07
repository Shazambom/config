// Node is used for the native HTTP/SSE provider and installed CLI JSONL protocol.
// The scripted provider only loads instructions; it never executes their workflow.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [cli, repo, normalHome, mode] = process.argv.slice(2);
const agentDir = process.env.PI_CODING_AGENT_DIR;
const names = ['complaint', 'address-complaint'];
const skills = Object.fromEntries(names.map(name => {
  const path = join(process.env.HOME, '.claude/skills', name, 'SKILL.md');
  return [name, { path, content: readFileSync(path, 'utf8') }];
}));
// Compare hashes in memory; never copy or print normal queue contents.
function snapshot(path) {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) return ['link', readlinkSync(path)];
  if (stat.isDirectory()) return ['directory', stat.mode, readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])];
  assert(stat.isFile(), 'Unexpected queue entry type');
  return ['file', stat.mode, stat.size, stat.mtimeMs, createHash('sha256').update(readFileSync(path)).digest('hex')];
}
const normalQueue = join(normalHome, '.pi/complaints');
const before = snapshot(normalQueue);
const privateQueue = join(process.env.HOME, '.pi/complaints');
assert.equal(snapshot(privateQueue), null, 'Private queue must start absent');
writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({
  skills: names.map(name => dirname(skills[name].path)),
  retry: { enabled: false }, compaction: { enabled: false },
}));
let failure;
let step;
let requests = 0;
const textOf = message => typeof message.content === 'string' ? message.content : (message.content ?? []).map(part => part.text ?? '').join('');
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests++;
    const system = body.messages.filter(m => m.role === 'system').map(textOf).join('\n');
    for (const name of names) {
      assert(!system.includes(`<name>${name}</name>`), `Manual skill leaked into system catalog: ${name}`);
      assert(!system.includes(skills[name].path), `Manual skill path leaked into system catalog: ${name}`);
    }
    assert(body.tools.some(t => t.function.name === 'load_workflow'), 'Real resolver must be loaded');
    assert(body.tools.every(t => ['read', 'load_workflow'].includes(t.function.name)), 'No mutating tools allowed');
    const last = body.messages.at(-1);
    const text = textOf(last);
    const { name, native } = step;
    const { path, content } = skills[name];
    let call;
    if (last.role === 'tool') {
      assert(!native);
      assert.equal(text, `Kind: skill\nName: ${name}\nPath: ${path}\nRelative references: ${dirname(path)}\n\n${content}`, 'Lookup must return unchanged complete source and base path');
      step.results++;
    } else {
      assert.equal(last.role, 'user');
      if (native) {
        const bodyText = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
        assert.equal(text, `<skill name="${name}" location="${path}">\nReferences are relative to ${dirname(path)}.\n\n${bodyText}\n</skill>\n\nLOAD_ONLY_ARGUMENT`, 'Native expansion must deliver exact body and base path');
        step.results++;
      } else {
        assert.equal(text, `/${name}`, 'Short spelling reaches provider unchanged, not as a native alias');
        call = { name: 'load_workflow', arguments: JSON.stringify({ name: `/${name}` }) };
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'load-only', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant' });
    if (call) send({ tool_calls: [{ index: 0, id: `lookup-${requests}`, type: 'function', function: call }] });
    else send({ content: 'LOAD_ONLY_OK' });
    send({}, call ? 'tool_calls' : 'stop');
    res.end('data: [DONE]\n\n');
  } catch (error) {
    failure = error;
    res.writeHead(400); res.end('fixture assertion failed');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', apiKey: 'local-fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
  models: [{ id: 'fixture', contextWindow: 128000, maxTokens: 2048 }],
} } }));
const child = spawn(process.execPath, [cli, '--mode', 'rpc', '--offline', '--no-session', '--no-extensions',
  '-e', join(repo, 'pi/agent/extensions/claude-skills.ts'), ...(mode === 'absent' ? ['--no-skills'] : []),
  '--tools', 'read,load_workflow', '--provider', 'fixture', '--model', 'fixture', '--thinking', 'off', '--no-approve'],
{ stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '', stderr = '', stopping = false;
const pending = new Map();
const rejectAll = error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); };
child.stderr.on('data', data => { stderr += data; });
child.on('error', rejectAll);
const exited = new Promise(resolve => child.on('exit', (code, signal) => {
  if (!stopping) rejectAll(new Error(`CLI exited ${code}/${signal}: ${stderr}`));
  resolve();
}));
child.stdout.on('data', data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const key = event.id ?? event.type;
    const waiter = pending.get(key);
    if (waiter) { pending.delete(key); waiter.resolve(event); }
  }
});
const receive = key => new Promise((resolve, reject) => pending.set(key, { resolve, reject }));
const command = value => {
  const result = receive(value.id);
  child.stdin.write(JSON.stringify(value) + '\n');
  return result;
};
const timeout = setTimeout(() => {
  rejectAll(new Error(`CLI deadline exceeded: ${stderr}`));
  child.kill('SIGKILL');
}, 45000);
try {
  const index = await command({ type: 'get_commands', id: 'index' });
  assert(index.success, JSON.stringify(index));
  for (const name of names) {
    assert(index.data.commands.some(c => c.name === `skill:${name}` && c.source === 'skill'), `Missing canonical skill command: skill:${name}`);
  }
  for (const name of names) for (const native of [true, false]) {
    step = { name, native, results: 0 };
    const settled = receive('agent_settled');
    // Attach immediately so an unexpected process exit cannot cause an unhandled rejection.
    settled.catch(() => {});
    const response = await command({ type: 'prompt', id: `${name}-${native}`, message: native ? `/skill:${name} LOAD_ONLY_ARGUMENT` : `/${name}` });
    assert(response.success, JSON.stringify(response));
    await settled;
    if (failure) throw failure;
    assert.equal(step.results, 1, 'Provider must observe exactly one successful expansion/lookup');
    assert.equal(snapshot(privateQueue), null, 'Loading instructions must not create a private queue');
    console.log(`PASS: ${name}: ${native ? 'native exact body/base path' : 'short name -> actual load_workflow -> exact complete file/base path'}`);
  }
  assert.equal(requests, 6);
  console.log('PASS: both canonical commands discovered; both manual skills excluded from provider system catalog');
} finally {
  clearTimeout(timeout);
  stopping = true;
  child.stdin.end();
  const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(kill);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.deepEqual(snapshot(normalQueue), before, 'Normal HOME complaint queue changed');
  assert.equal(snapshot(privateQueue), null, 'Private queue was created');
  console.log('PASS: normal HOME queue unchanged; private queue absent');
}

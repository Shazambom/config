// Exercise the installed CLI's provider input, not a reconstructed prompt.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const agentDir = process.env.PI_CODING_AGENT_DIR;
const cli = process.env.PI_WORKFLOW_CLI;
const expected = readFileSync(join(process.env.HOME, '.claude/commands/tdd.md'), 'utf8');
const requests = [];
let failure;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    assert(body.tools.some(t => t.function.name === 'load_workflow'));
    let call;
    const last = body.messages.at(-1);
    const text = typeof last.content === 'string' ? last.content : last.content.map(part => part.text ?? '').join('');
    if (last.role === 'user' && text === 'LOOKUP_TDD') {
      call = { name: 'load_workflow', arguments: JSON.stringify({ name: '/tdd' }) };
    } else if (last.role === 'tool') {
      assert(text.includes(`Path: ${join(process.env.HOME, '.claude/commands/tdd.md')}`));
      assert(text.endsWith(expected));
    } else {
      assert.equal(last.role, 'user');
      const nativeBody = expected.replace(/^---\n[\s\S]*?\n---\n/, '').trim().replaceAll('$ARGUMENTS', 'NATIVE_ARGUMENT');
      assert.equal(text.trim(), nativeBody, 'Native /tdd must inline the existing prompt');
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'lookup', object: 'chat.completion.chunk', created: 0, model: 'lookup', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant' });
    if (call) send({ tool_calls: [{ index: 0, id: 'lookup', type: 'function', function: call }] });
    else send({ content: 'LOAD_ONLY_OK' });
    send({}, call ? 'tool_calls' : 'stop');
    res.end('data: [DONE]\n\n');
  } catch (error) { failure = error; res.writeHead(400); res.end('fixture failed'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { lookup: { api: 'openai-completions', apiKey: 'local-fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'lookup', contextWindow: 128000, maxTokens: 2048 }] } } }));
const child = spawn(process.execPath, [cli, '--mode', 'rpc', '--offline', '--no-session', '--no-extensions', '-e', join(agentDir, 'extensions/claude-skills.ts'), '--tools', 'read,load_workflow', '--provider', 'lookup', '--model', 'lookup', '--thinking', 'off', '--no-approve'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '', stderr = '';
const pending = new Map();
child.stderr.on('data', data => { stderr += data; });
child.stdout.on('data', data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    let event; try { event = JSON.parse(line); } catch { continue; }
    const resolve = pending.get(event.id ?? event.type);
    if (resolve) { pending.delete(event.id ?? event.type); resolve(event); }
  }
});
const receive = key => new Promise(resolve => pending.set(key, resolve));
const command = async value => { const result = receive(value.id); child.stdin.write(JSON.stringify(value) + '\n'); return result; };
const timeout = setTimeout(() => { console.error(stderr); child.kill('SIGKILL'); process.exitCode = 1; }, 45000);
try {
  const index = await command({ type: 'get_commands', id: 'index' });
  assert(index.success);
  assert(index.data.commands.some(c => c.name === 'tdd' && c.source === 'prompt'));
  assert(!index.data.commands.some(c => c.name === 'skill:tdd'));
  for (const [id, message] of [['native', '/tdd NATIVE_ARGUMENT'], ['lookup', 'LOOKUP_TDD']]) {
    const ended = receive('agent_end');
    const accepted = await command({ type: 'prompt', id, message });
    assert(accepted.success, JSON.stringify(accepted));
    await ended;
    if (failure) throw failure;
  }
  assert.equal(requests.length, 3);
  console.log(`PASS: ${cli}: restricted fresh RPC CLI native /tdd expansion and load_workflow full unchanged prompt at provider boundary.`);
} finally {
  clearTimeout(timeout);
  child.kill('SIGTERM');
  server.closeAllConnections(); server.close();
}

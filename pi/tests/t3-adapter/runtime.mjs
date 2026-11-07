// Node drives the installed CLI's asynchronous RPC and loopback MCP protocols.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [source, cli, work] = process.argv.slice(2);
let inference = 0;
const calls = [];
const server = createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  if (req.url === '/v1/chat/completions') {
    inference++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ id: 'proof', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'UNBOUND_INFERENCE' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    return;
  }
  assert.equal(req.headers.authorization, 'Bearer synthetic-proof');
  calls.push({ method: body.method, name: body.params?.name });
  let result;
  if (body.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 't3-fixture', version: '1' } };
  else if (body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
  else if (body.method === 'tools/call') {
    assert(['t3_thread_list', 't3_thread_read'].includes(body.params.name), 'use public T3 discovery tool names');
    const data = body.params.name === 't3_thread_list'
      ? { currentThreadId: 'child-thread', threads: [] }
      : { thread: { threadId: 'child-thread', parentThreadId: 'parent-thread', activeRunId: 'child-run', latestRunId: 'child-run' }, recentRuns: [{ runId: 'child-run', status: 'running' }] };
    result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
  } else result = { tools: [] };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions', apiKey: 'synthetic', baseUrl: `${baseUrl}/v1`, models: [{ id: 'fixture', input: ['text'], contextWindow: 100000, maxTokens: 1000 }] } } }));
const cwd = join(work, 'unbound'); mkdirSync(cwd);
const args = ['--mode', 'rpc', '--no-extensions', '--no-skills', '--no-prompt-templates', '--provider', 'fixture', '--model', 'fixture', '--session', join(cwd, 'session.jsonl'), '-e', join(source, 'pi-extension/subagents/index.ts'), '--t3', '--team'];
const child = spawn(cli, args, { cwd, env: { ...process.env, T3_MCP_URL: `${baseUrl}/mcp`, T3_MCP_BEARER_TOKEN: 'synthetic-proof' }, stdio: ['pipe', 'pipe', 'pipe'] });
const records = []; let buffer = '';
child.stdout.on('data', chunk => {
  appendFileSync(join(work, 'stdout.jsonl'), chunk);
  buffer += chunk;
  for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break; const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (line.trim()) records.push(JSON.parse(line)); }
});
child.stderr.on('data', chunk => appendFileSync(join(work, 'stderr.txt'), chunk));
function wait(predicate, label) {
  const deadline = Date.now() + 20000;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const record = records.find(predicate);
      if (record) return resolve(record);
      if (child.exitCode !== null || child.signalCode !== null) return reject(new Error(`CLI exited before ${label}; inspect ${work}`));
      if (Date.now() >= deadline) return reject(new Error(`Timed out waiting for ${label}; inspect ${work}`));
      setTimeout(tick, 20);
    }; tick();
  });
}
try {
  child.stdin.write(JSON.stringify({ id: 'state', type: 'get_state' }) + '\n');
  const state = await wait(r => r.id === 'state', 'readonly discovery');
  assert.equal(state.success, true, 'unbound child must permit readonly get_state');
  for (const command of [
    { id: 'entries', type: 'get_entries' },
    { id: 'model-before-binding', type: 'set_model', provider: 'fixture', modelId: 'fixture' },
    { id: 'thinking-before-binding', type: 'set_thinking_level', level: 'medium' },
    { id: 'name-before-binding', type: 'set_session_name', name: 'Native startup' },
  ]) {
    child.stdin.write(JSON.stringify(command) + '\n');
    const response = await wait(r => r.id === command.id, `native startup ${command.type}`);
    assert.equal(response.success, true, `${command.type} must remain usable during native startup without inference`);
    assert.equal(inference, 0, 'no provider calls from metadata before binding');
  }
  child.stdin.write(JSON.stringify({ id: 'race', type: 'prompt', message: 'Do not infer until bound.' }) + '\n');
  const response = await wait(r => r.id === 'race', 'original prompt refusal');
  assert.equal(response.success, false, 'unbound native child must refuse the original RPC prompt, not acknowledge or infer');
  assert.match(response.error, /T3.*bind|bind.*T3/i);
  assert.equal(inference, 0, 'no provider request before authenticated parent binding');
  assert(calls.some(c => c.name === 't3_thread_list'), 'identity discovery uses authenticated thread_list');
  assert(calls.some(c => c.name === 't3_thread_read'), 'lineage discovery uses authenticated thread_read');
  console.log('PASS unbound native child refuses inference while readonly RPC remains available');
} finally {
  writeFileSync(join(work, 'evidence.json'), JSON.stringify({ inference, calls, records }, null, 2));
  child.stdin.end();
  await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(() => child.kill('SIGKILL'), 1000).unref(); });
  await new Promise(resolve => server.close(resolve));
}

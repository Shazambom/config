// The real bundled CLI and Bash tool require Node. All inference is loopback.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [cli, work] = process.argv.slice(2);
const agent = join(work, 'tool-agent');
mkdirSync(agent);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const receipt = join(work, 'tool-failed.json');
const command = `bash ${quote(join(work, 'repo/init.sh'))} --pi-delivery ${quote(receipt)}`;
let requests = 0;
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  writeFileSync(join(work, `tool-provider-${++requests}.json`), JSON.stringify(request, null, 2));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const base = { id: `fixture-${requests}`, object: 'chat.completion.chunk', created: 1, model: request.model };
  const first = requests === 1;
  const delta = first ? { role: 'assistant', tool_calls: [{ index: 0, id: 'delivery-check', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command }) } }] } : { role: 'assistant', content: 'Fixture complete.' };
  for (const [d, finish_reason] of [[delta, null], [{}, first ? 'tool_calls' : 'stop']]) {
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: d, finish_reason }] })}\n\n`);
  }
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
writeFileSync(join(agent, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions', apiKey: 'synthetic', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'fixture', contextWindow: 100000, maxTokens: 1000 }] } } }));
writeFileSync(join(agent, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', retry: { enabled: false }, compaction: { enabled: false } }));
let child;
let timer;
try {
  child = spawn(process.execPath, [cli, '--mode', 'json', '--no-session', '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-context-files', '--tools', 'bash', 'Run the one fixture command.'], {
    cwd: work, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  const [code] = await once(child, 'exit');
  writeFileSync(join(work, 'tool-events.jsonl'), stdout);
  writeFileSync(join(work, 'tool-stderr.txt'), stderr);
  assert.equal(code, 0, stderr);
  const events = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const outcome = events.find(event => event.type === 'tool_execution_end' && event.toolName === 'bash');
  assert(outcome, 'real Bash tool must execute');
  assert.equal(outcome.isError, true);
  assert.equal(outcome.result.isError, true);
  assert.equal(outcome.result.structuredContent.exit_code, 1);
  assert.match(outcome.result.structuredContent.output, /setup exit 0; artifact check: failed; entry point: not run; behavior: not run/);
  assert(outcome.result.structuredContent.output.includes(receipt));
  const observed = JSON.parse(readFileSync(receipt));
  assert.equal(observed.setup_exit, 0);
  assert.equal(observed.artifact_check.state, 'failed');
  assert.equal(observed.behavior, 'not_run');
  assert.equal(requests, 2);
  console.log('PASS: actual bundled Pi -> scripted provider -> Bash -> init -> matching failed receipt and isError/exit_code');
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await new Promise(resolve => server.close(resolve));
}

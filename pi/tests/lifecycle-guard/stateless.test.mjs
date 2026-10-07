import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createJiti } from 'jiti';
import { createEventBus } from '@earendil-works/pi-coding-agent';

const extension = new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url);
test('ordinary no-file startup and reload stay explicitly unprotected without investigation, helper or lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-stateless-unit-'));
  const previous = process.env.PI_CODING_AGENT_DIR, previousOwner = process.env.PI_LIFECYCLE_OWNER;
  process.env.PI_CODING_AGENT_DIR = root; delete process.env.PI_LIFECYCLE_OWNER;
  const handlers = {}, messages = [], warnings = [];
  const pi = { events: createEventBus(), on: (event, handler) => handlers[event] = handler, registerCommand() {}, sendUserMessage: value => messages.push(value) };
  const ctx = { hasUI: true, sessionManager: { getSessionFile: () => undefined }, ui: { setWidget: (...args) => warnings.push(args), setStatus() {} } };
  try {
    const jiti = createJiti(import.meta.url), factory = (await jiti.import(extension.href)).default;
    factory(pi);
    await handlers.session_start({ reason: 'startup' }, ctx);
    for (let i = 0; i < 2; i++) {
      let admission; pi.events.emit('session-lifecycle:admission', { respond: value => admission = value });
      assert.deepEqual(admission, { managed: true, status: 'unprotected', reason: 'STATELESS_SESSION' });
      assert.equal(await handlers.input({}, ctx), undefined);
      assert.equal(await handlers.tool_call({}, ctx), undefined);
      assert.equal(globalThis[Symbol.for('portable-pi.session-lifecycle')].child, undefined);
      assert.deepEqual(await readdir(root), []);
      assert.deepEqual(messages, []); assert.deepEqual(warnings, []);
      await handlers.session_shutdown({ reason: 'reload' }, ctx);
      factory(pi); await handlers.session_start({ reason: 'reload' }, ctx);
    }
    await handlers.session_shutdown({ reason: 'quit' }, ctx);
  } finally {
    delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    if (previousOwner === undefined) delete process.env.PI_LIFECYCLE_OWNER; else process.env.PI_LIFECYCLE_OWNER = previousOwner;
    await rm(root, { recursive: true, force: true });
  }
});

for (const persistedFailure of [false, true]) for (const mode of ['print', 'rpc']) test(`installed CLI ${persistedFailure ? 'persisted initialization failure' : 'ordinary stateless'} ${mode} makes exactly one supplied-user request`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-stateless-cli-'));
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'STATELESS_REPLY' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  let child;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const agent = join(root, 'agent'); await mkdir(agent);
    const file = join(root, 'session.jsonl');
    if (persistedFailure) {
      await writeFile(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: root }) + '\n');
      await writeFile(join(root, '.pi-lifecycle'), 'deliberate fixture obstruction');
    }
    await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { lifecycle: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'synthetic-only', models: [{ id: 'offline', contextWindow: 128000, maxTokens: 1024 }] } } }));
    const cli = execFileSync('bash', ['-c', 'source "$1"; pi_real_command "$(command -v pi)"', 'stateless-test', fileURLToPath(new URL('../../command-path.sh', import.meta.url))], { encoding: 'utf8' }).trim();
    const env = { ...process.env, PI_CODING_AGENT_DIR: agent, TMUX: '', TMUX_PANE: '' }; delete env.PI_LIFECYCLE_OWNER;
    const args = [cli, ...(persistedFailure ? ['--session', file] : ['--no-session']), '--provider', 'lifecycle', '--model', 'offline', '--no-extensions', '--no-mcp', '--no-context-files', '--no-skills', '--no-prompt-templates', '--extension', fileURLToPath(extension), '--extension', fileURLToPath(new URL('./worker-startup-probe.ts', import.meta.url)),
      ...(mode === 'print' ? ['--print', 'STATELESS_PRINT_INPUT'] : ['--mode', 'rpc'])];
    child = spawn(process.execPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let stdout = '', stderr = ''; child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    if (mode === 'rpc') {
      if (persistedFailure) {
        for (let i = 0; i < 200 && !stdout.includes('OWNERSHIP PROTECTION FAILED'); i++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok(stdout.includes('extension_ui_request') && stdout.includes('OWNERSHIP PROTECTION FAILED'));
        assert.equal(requests.length, 0, 'RPC reports failure before the caller requests model work');
      }
      child.stdin.write(JSON.stringify({ id: 'task', type: 'prompt', message: 'STATELESS_RPC_INPUT' }) + '\n');
    } else child.stdin.end(); // Print mode waits for piped stdin EOF before startup.
    if (mode === 'print') {
      let timer;
      try { const [code] = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('stateless print hung')), 6000); })]); assert.equal(code, 0, stderr); }
      finally { clearTimeout(timer); }
    } else {
      for (let i = 0; i < 250 && !stdout.includes('STATELESS_REPLY'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(stdout.includes('STATELESS_REPLY'), stderr);
    assert.equal(requests.length, 1, 'no injected investigation turn');
    const users = requests[0].messages.filter(message => message.role === 'user');
    assert.equal(users.length, 1);
    assert.ok(JSON.stringify(users[0].content).includes(mode === 'print' ? 'STATELESS_PRINT_INPUT' : 'STATELESS_RPC_INPUT'));
    const startup = JSON.parse(await readFile(join(agent, 'worker-startup.json'), 'utf8'));
    if (persistedFailure) {
      assert.equal(startup.admission.status, 'unprotected'); assert.equal(startup.admission.reason, 'EEXIST');
      const diagnostic = JSON.parse(await readFile(startup.admission.diagnostic, 'utf8'));
      assert.equal(diagnostic.code, 'EEXIST');
      assert.equal(startup.sessionFile, file);
      const report = mode === 'print' ? stderr : stdout;
      assert.ok(report.includes('OWNERSHIP PROTECTION FAILED') && report.includes(startup.admission.diagnostic));
      if (mode === 'rpc') assert.ok(stdout.includes('extension_ui_request'), 'RPC warning must use the protocol');
    } else {
      assert.ok(!stderr.includes('OWNERSHIP PROTECTION FAILED'));
      assert.deepEqual(startup.admission, { managed: true, status: 'unprotected', reason: 'STATELESS_SESSION' });
      assert.equal(startup.sessionFile, undefined);
      assert.ok(!(await readdir(agent)).includes('lifecycle-diagnostics'));
      assert.ok(!(await readdir(root)).includes('.pi-lifecycle'));
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

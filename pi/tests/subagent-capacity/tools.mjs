import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createJiti } from 'jiti';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { realpathSync, existsSync } from 'node:fs';
let installedRoot = dirname(realpathSync(process.env.CAPACITY_TEST_CLI));
for (;;) {
  const manifest = join(installedRoot, 'package.json');
  if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === '@earendil-works/pi-coding-agent') break;
  const parent = dirname(installedRoot);
  assert.notEqual(parent, installedRoot, 'Cannot locate Pi package from resolved active CLI');
  installedRoot = parent;
}
const requireInstalled = createRequire(join(installedRoot, 'package.json'));
const installed = { resolve(name) {
  if (name === '@earendil-works/pi-coding-agent' || name === '@earendil-works/pi-ai') {
    const root = name.endsWith('/pi-coding-agent') ? installedRoot : join(installedRoot, 'node_modules', name);
    const spec = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return join(root, spec.exports['.'].import);
  }
  return requireInstalled.resolve(name);
} };
console.log(`Installed SDK: ${JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8')).version}`);
const { ModelRuntime, ModelRegistry, SessionManager, createAgentSession, DefaultResourceLoader, SettingsManager } = await import(pathToFileURL(installed.resolve('@earendil-works/pi-coding-agent')));
const { InMemoryCredentialStore, createAssistantMessageEventStream } = await import(pathToFileURL(installed.resolve('@earendil-works/pi-ai')));

export async function checkTools(source, lab, freeSpace) {
  globalThis.fetch = async () => { throw new Error('Network forbidden'); };
  const jiti = createJiti(import.meta.url, { alias: Object.fromEntries([
    ['@mariozechner/pi-tui', '@earendil-works/pi-tui'],
    ['@mariozechner/pi-coding-agent', '@earendil-works/pi-coding-agent'],
    ['@mariozechner/pi-ai', '@earendil-works/pi-ai'],
    ['@sinclair/typebox', 'typebox'],
  ].map(([a, b]) => [a, installed.resolve(b)])) });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
  runtime.registerProvider('capacity-fixture', { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'synthetic', models: [{ id: 'test', name: 'test', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 }] });
  const agents = join(process.env.PI_CODING_AGENT_DIR, 'agents');
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, 'fixture.md'), '---\nname: fixture\ndescription: test\n---\nSynthetic only.\n');
  const tools = new Map(), hooks = new Map(), events = new EventEmitter();
  const extension = (await jiti.import(join(source, 'pi-extension/subagents/index.ts'))).default;
  const sessionManager = SessionManager.create(lab, join(lab, 'sessions'));
  const ctx = { cwd: lab, sessionManager, model: runtime.getModel('capacity-fixture', 'test'), modelRegistry: new ModelRegistry(runtime), hasUI: false, isIdle: () => true, hasPendingMessages: () => false, ui: { notify() {} } };
  extension({
    on(n, cb) { hooks.set(n, [...hooks.get(n) ?? [], cb]); },
    events: { emit: (n, v) => events.emit(n, v), on(n, cb) { events.on(n, cb); return () => events.off(n, cb); } },
    registerFlag() {}, getFlag() { return false; },
    registerTool: t => tools.set(t.name, t), registerCommand() {}, registerMessageRenderer() {}, sendMessage() {},
    getActiveTools: () => [], setActiveTools() {},
  });
  const helpers = await jiti.import(join(source, 'pi-extension/subagents/session.ts'));
  const artifact = join(sessionManager.getSessionDir(), 'artifacts', sessionManager.getSessionId());
  const saved = join(lab, 'saved.jsonl');
  writeFileSync(saved, '');
  helpers.registerName(artifact, 'saved', { sessionFile: saved, sessionId: 'saved' });
  helpers.writeSubagentLoadout(saved, { model: 'capacity-fixture/test', toolAllowlist: 'read', agent: 'fixture' });
  const snapshot = () => readdirSync(lab, { recursive: true }).filter(f => /registry|scripts|loadout|team/.test(f)).map(f => [f, (() => { try { return readFileSync(join(lab, f), 'utf8'); } catch { return ''; } })()]);
  const call = (tool, params) => tools.get(tool).execute('capacity', params, undefined, undefined, ctx);
  try {
    for (const cb of hooks.get('session_start') ?? []) await cb({ type: 'session_start', reason: 'startup' }, ctx);
    const before = snapshot();
    for (const [tool, params] of [
      ['subagent', { agent: 'fixture', task: 'DO NOT DISPATCH' }],
      ['subagent', { agent: 'fixture', task: 'DO NOT DISPATCH' }],
      ['subagent_message', { name: 'saved', message: 'DO NOT DISPATCH' }],
    ]) {
      await assert.rejects(call(tool, params), error => {
        const { message, ...flags } = JSON.parse(error.message);
        assert.deepEqual(flags, { code: 'TMUX_PANE_CAPACITY', launched: false, queued: false, retryable: true });
        assert.match(message, /not launched/i);
        assert.match(message, /after.*complet/i);
        assert.match(message, /not poll|no polling/i);
        return true;
      });
      assert.deepEqual(snapshot(), before, 'no task scripts, phantom registry entries, loadouts or team reservations');
    }
    console.log('PASS real registered spawn/resume tools: structured capacity, no dispatch/shared mutation');
    const captures = [];
    let action;
    const provider = { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'synthetic', models: [{ id: 'test', name: 'test', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 100 }], streamSimple(model, context) {
      captures.push(context);
      const next = action; action = undefined;
      const message = { role: 'assistant', content: next ? [{ type: 'toolCall', id: `call-${captures.length}`, name: next.name, arguments: next.args }] : [{ type: 'text', text: 'done' }], api: model.api, provider: model.provider, model: model.id, stopReason: next ? 'toolUse' : 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); });
      return stream;
    } };
    runtime.registerProvider('capacity-fixture', provider);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: lab, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, extensionFactories: [pi => {
      pi.registerProvider('capacity-fixture', provider);
      // Registered production tools, executed by the SDK's real tool loop.
      for (const name of ['subagent', 'subagent_message']) pi.registerTool(tools.get(name));
    }] });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: lab, agentDir: process.env.PI_CODING_AGENT_DIR, modelRuntime: runtime, resourceLoader: loader, settingsManager, sessionManager, model: runtime.getModel('capacity-fixture', 'test'), tools: ['subagent', 'subagent_message'] });
    await session.bindExtensions({ mode: 'print' });
    try {
      for (const next of [{ name: 'subagent', args: { agent: 'fixture', task: 'SDK NO DISPATCH' } }, { name: 'subagent_message', args: { name: 'saved', message: 'SDK NO DISPATCH' } }]) {
        action = next;
        await session.prompt('Exercise capacity response');
        const result = captures.at(-1).messages.filter(m => m.role === 'toolResult').at(-1);
        assert.equal(result.isError, true, JSON.stringify(result));
        const { message, ...flags } = JSON.parse(result.content[0].text);
        assert.deepEqual(flags, { code: 'TMUX_PANE_CAPACITY', launched: false, queued: false, retryable: true });
        assert.match(message, /after.*complet/i);
      }
      assert.deepEqual(snapshot(), before);
      writeFileSync(join(lab, 'provider-contexts.json'), JSON.stringify(captures, null, 2));
      console.log('PASS SDK tool loop delivers structured flags and retry guidance in next provider context');
    } finally { session.dispose(); }
    // Explicit retry uses the production command-dispatch path with a private
    // no-model actor instead of launching a real inference process.
    freeSpace();
    const actor = join(lab, 'actor.mjs'), dispatch = join(lab, 'dispatch.jsonl');
    writeFileSync(actor, `import { appendFileSync, readFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(dispatch)}, JSON.stringify({ pid: process.pid, args: process.argv.slice(2).map(a => a.startsWith('@') ? readFileSync(a.slice(1), 'utf8') : a) }) + '\\n');\nsetInterval(() => {}, 1000);\n`);
    const previous = process.argv[1];
    try {
      process.argv[1] = actor;
      const fresh = await call('subagent', { agent: 'fixture', task: 'RETRY FRESH EXACT TASK' });
      assert.equal(fresh.details.name, 'fixture', 'failed reservations must release the default name');
      const resumed = await call('subagent_message', { name: 'saved', message: 'RETRY RESUME EXACT TASK' });
      assert.equal(resumed.details.name, 'saved');
      const deadline = Date.now() + 5000;
      let records = [];
      while (records.length < 2 && Date.now() < deadline) {
        try { records = readFileSync(dispatch, 'utf8').trim().split('\n').map(JSON.parse); } catch {}
        if (records.length < 2) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(records.length, 2);
      assert(records.some(r => r.args.some(a => a.includes('RETRY FRESH EXACT TASK'))));
      assert(records.some(r => r.args.some(a => a.includes('RETRY RESUME EXACT TASK'))));
      console.log('PASS explicit fresh/resume retries after freeing space dispatch each exact task once; default name reclaimed');
    } finally { process.argv[1] = previous; }
  } finally {
    for (const cb of hooks.get('session_shutdown') ?? []) await cb({ type: 'session_shutdown', reason: 'quit' }, ctx);
  }
}

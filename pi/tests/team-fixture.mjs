import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJiti } from 'jiti';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, createAssistantMessageEventStream } from '@earendil-works/pi-ai';

let network = 0;
globalThis.fetch = async () => { network++; throw new Error('Network forbidden'); };
const source = process.argv[2];
const jiti = createJiti(import.meta.url, { alias: {
  '@mariozechner/pi-coding-agent': import.meta.resolve('@earendil-works/pi-coding-agent').replace('file://', ''),
  '@sinclair/typebox': import.meta.resolve('typebox').replace('file://', ''),
} });
const { TeamStore, effective } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const teamExtension = (await jiti.import(join(source, 'pi-extension/subagents/team-extension.ts'))).default;
const { installArena } = await jiti.import(join(source, 'pi-extension/subagents/team-arena.ts'));
const temp = mkdtempSync(join(tmpdir(), 'pi-team-fixture-'));
const sessions = [];
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const modelSpec = { id: 'test', name: 'test', reasoning: false, input: ['text'], cost: usage.cost, contextWindow: 100000, maxTokens: 100 };
const stateDir = join(temp, 'team');
const store = TeamStore.create(stateDir);
try {
  for (const [id, name, parent] of [['root', 'orchestrator', null], ['a', 'alice', 'root'], ['b', 'bob', 'root'], ['c', 'bob/carol', 'b']]) await store.register({ id, name, parent, live: true });
  await assert.rejects(store.send('a', { to: 'bob', message: 'off' }), /OFF/);
  assert(!existsSync(join(stateDir, 'messages.jsonl')));
  await store.setDesired(true);
  const dm = await store.send('a', { to: 'bob', message: 'question', sender: 'spoof' });
  assert.equal(dm.fromName, 'alice');
  assert.deepEqual(dm.recipients, ['b', 'root']);
  assert.equal(store.pending('root', new Set()).filter(m => m.id === dm.id).length, 1);
  const reply = await store.send('b', { to: 'alice', message: 'answer', reply_to: dm.id });
  assert.equal(reply.reply_to, dm.id);
  await assert.rejects(store.send('root', { to: 'alice', message: 'not my question', reply_to: dm.id }), /reply_to/);
  const broadcast = await store.send('c', { to: '#team', message: 'finding' });
  assert.deepEqual(broadcast.recipients.sort(), ['a', 'b', 'root']);
  assert.equal((await store.send('c', { to: 'parent', message: 'parent alias' })).recipients[0], 'b');
  assert.equal((await store.send('b', { to: 'orchestrator', message: 'root alias' })).recipients.length, 1);
  await assert.rejects(store.send('a', { to: 'missing', message: 'x' }), /Unknown/);
  await assert.rejects(store.send('a', { to: 'bob', message: 'x'.repeat(4097) }), /4096/);
  await assert.rejects(store.send('a', { to: '#team', message: 'x', wait_for_reply: true }), /Broadcasts/);
  await assert.rejects(store.send('a', { to: 'bob', message: 'x', reply_to: 'missing' }), /reply_to/);
  await store.update('b', { live: false });
  await assert.rejects(store.send('a', { to: 'bob', message: 'x' }), /completed/);
  await store.update('b', { live: true });
  await store.setDesired(false);
  assert.equal(store.pending('a', new Set()).length, 0);
  await store.setDesired(true);
  assert.equal(store.pending('a', new Set()).length, 0, 'OFF invalidates prior generation');
  await store.withSuspension(async () => {
    assert.equal(effective(store.state()), false);
    await store.setDesired(true);
    assert.equal(effective(store.state()), false);
    await store.withSuspension(async () => assert.equal(store.state().leases.length, 2));
    assert.equal(effective(store.state()), false);
  });
  assert.equal(effective(store.state()), true);
  await assert.rejects(store.withSuspension(async () => { throw new Error('failure'); }), /failure/);
  assert.equal(effective(store.state()), true);
  await store.withSuspension(async () => store.setDesired(false));
  assert.equal(effective(store.state()), false, 'explicit OFF survives lease');

  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
  const captures = new Map();
  const scripts = new Map();
  async function makeSession(id, arenaHooks) {
    process.env.PI_TEAM_DIR = stateDir;
    process.env.PI_TEAM_MEMBER = id;
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    let api;
    const provider = { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'synthetic', models: [modelSpec], streamSimple: (model, context) => {
      const list = captures.get(id) ?? []; list.push(context); captures.set(id, list);
      const action = scripts.get(id)?.shift();
      const content = action ? [{ type: 'toolCall', id: `call-${Date.now()}`, name: 'team_send', arguments: action }] : [{ type: 'text', text: 'done' }];
      const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, stopReason: action ? 'toolUse' : 'stop', timestamp: Date.now(), usage };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); });
      return stream;
    } };
    runtime.registerProvider(`fixture-${id}`, provider);
    const skillFile = join(temp, 'arena-SKILL.md'); writeFileSync(skillFile, 'Independent candidates.');
    const loader = new DefaultResourceLoader({ cwd: temp, agentDir: temp, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true,
      skillsOverride: () => ({ skills: [{ name: 'arena', description: 'arena', filePath: skillFile, baseDir: temp, source: 'test' }], diagnostics: [] }),
      extensionFactories: [pi => { api = pi; pi.registerProvider(`fixture-${id}`, provider); teamExtension(pi); if (arenaHooks) installArena(pi, arenaHooks); }],
    });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: temp, agentDir: temp, modelRuntime: runtime, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(temp), model: runtime.getModel(`fixture-${id}`, 'test'), tools: ['read', 'team_send'] });
    await session.bindExtensions({ mode: 'print' });
    sessions.push(session);
    return { session, api };
  }
  const root = await makeSession('root');
  const receipts = [];
  root.api.events.on('team:receipt', message => receipts.push(message));
  const a = await makeSession('a');
  const b = await makeSession('b');
  assert(!root.api.getActiveTools().includes('team_send'));
  await root.session.prompt('off schema');
  assert(!JSON.stringify(captures.get('root').at(-1).tools).includes('team_send'));
  assert(!captures.get('root').at(-1).systemPrompt.includes('team_send'));
  await root.session.prompt('/team on');
  await a.session.prompt('on schema');
  assert(a.api.getActiveTools().includes('team_send'));
  assert(JSON.stringify(captures.get('a').at(-1).tools).includes('team_send'));
  assert(captures.get('a').at(-1).systemPrompt.includes('team_send'));

  scripts.set('a', [{ to: 'bob', message: 'SDK direct question', wait_for_reply: true }]);
  const questionRun = a.session.prompt('ask now');
  const deadline = Date.now() + 3000;
  let question;
  while (!question && Date.now() < deadline) { question = store.messages().find(m => m.message === 'SDK direct question'); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert(question);
  scripts.set('b', [{ to: 'alice', message: 'SDK answer', reply_to: question.id }]);
  await b.session.prompt('answer now');
  await questionRun;
  const answered = a.session.messages.find(m => m.role === 'toolResult' && m.details?.status === 'replied');
  assert(answered);
  assert.match(JSON.stringify(answered.content), /SDK answer/);
  assert.equal(captures.get('a').flatMap(c => c.messages).filter(m => m.customType === 'team-peer' && String(m.content).includes('SDK answer')).length, 0, 'reply only arrives via waiting tool');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(receipts.filter(m => m.id === question.id).length, 1, 'passive root receipt exactly once without model turn');
  assert(receipts.some(m => m.message === 'SDK answer'));
  await root.session.prompt('consume passive mirrors');
  const rootContext = JSON.stringify(captures.get('root').at(-1).messages);
  assert.match(rootContext, /SDK direct question/);
  assert.match(rootContext, /SDK answer/);

  const stale = await store.send('a', { to: 'orchestrator', message: 'unconsumed stale marker' });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert(receipts.some(m => m.id === stale.id));
  await root.session.prompt('/team off');
  await root.session.prompt('/team on');
  await root.session.prompt('stale must not be consumed');
  assert(!JSON.stringify(captures.get('root').at(-1).messages).includes('unconsumed stale marker'));
  scripts.set('a', [{ to: 'bob', message: 'timeout test', wait_for_reply: true }]);
  const timeoutRun = a.session.prompt('timeout');
  while (!store.messages().some(m => m.message === 'timeout test')) await new Promise(resolve => setTimeout(resolve, 10));
  const realNow = Date.now;
  Date.now = () => realNow() + 61000;
  try { await timeoutRun; } finally { Date.now = realNow; }
  assert(a.session.messages.some(m => m.role === 'toolResult' && m.details?.status === 'timeout'));

  scripts.set('a', [{ to: 'bob', message: 'cancel this wait', wait_for_reply: true }]);
  const cancelled = a.session.prompt('ask again');
  while (!store.messages().some(m => m.message === 'cancel this wait')) await new Promise(resolve => setTimeout(resolve, 10));
  await root.session.prompt('/team off');
  await cancelled;
  assert(a.session.messages.some(m => m.role === 'toolResult' && m.details?.status === 'cancelled'));
  assert(!a.api.getActiveTools().includes('team_send'));
  await b.session.prompt('off propagation');
  assert(!JSON.stringify(captures.get('b').at(-1).tools).includes('team_send'));
  assert(!captures.get('b').at(-1).systemPrompt.includes('team_send'));
  const logBefore = readFileSync(join(stateDir, 'messages.jsonl'), 'utf8');
  await assert.rejects(store.send('a', { to: 'bob', message: 'off rejected' }), /OFF/);
  assert.equal(readFileSync(join(stateDir, 'messages.jsonl'), 'utf8'), logBefore);
  await root.session.prompt('/team on');
  b.api.events.emit('team:completed', {});
  await new Promise(resolve => setTimeout(resolve, 25));
  await assert.rejects(store.send('a', { to: 'bob', message: 'do not restart' }), /completed/);

  let outcome = 'ok'; let launched = 0;
  const arena = await makeSession('arena-root', {
    async launch() {
      launched++;
      assert.equal(effective(store.state()), false);
      if (outcome === 'launch-failure') throw new Error('launch failed');
      const sessionFile = join(temp, `coordinator-${launched}`);
      await store.register({ id: `coordinator-${launched}`, name: `coordinator-${launched}`, parent: 'arena-root', live: true });
      writeFileSync(`${sessionFile}.team.json`, JSON.stringify({ id: `coordinator-${launched}`, dir: stateDir }));
      return { sessionFile, surface: 'fixture' };
    },
    async watch(_running, signal) {
      if (outcome === 'cancel') await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      if (outcome === 'watch-failure') throw new Error('watch failed');
      return { summary: 'fixture result', exitCode: signal.aborted ? 1 : 0 };
    }, close() {},
  });
  for (const desired of [false, true]) {
    await store.setDesired(desired);
    for (const mode of ['ok', 'launch-failure', 'watch-failure']) { outcome = mode; await arena.session.prompt('/arena task'); assert.equal(effective(store.state()), desired); }
    outcome = 'cancel';
    const pending = arena.session.prompt('/arena task');
    await new Promise(resolve => setTimeout(resolve, 30));
    await arena.session.prompt('/arena cancel'); await pending;
    assert.equal(effective(store.state()), desired);
  }
  outcome = 'ok';
  const count = launched;
  await arena.session.prompt('/skill:arena alias');
  assert.equal(launched, count + 1, 'skill alias dispatches exactly once');
  assert.equal(network, 0);
  console.log('PASS team: filesystem routing, root mirror, bounds, identity, generations, nested leases, actual SDK active schemas/prompts, explicit reply wait, OFF cancellation, completed child, arena success/failure/cancel and alias. No network.');
} finally {
  for (const session of sessions) { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); }
  delete process.env.PI_TEAM_DIR; delete process.env.PI_TEAM_MEMBER;
  rmSync(temp, { recursive: true, force: true });
}

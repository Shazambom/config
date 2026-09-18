import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
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
  '@mariozechner/pi-tui': import.meta.resolve('@earendil-works/pi-tui').replace('file://', ''),
  '@mariozechner/pi-ai': import.meta.resolve('@earendil-works/pi-ai').replace('file://', ''),
} });
const { TeamStore, effective } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const teamExtension = (await jiti.import(join(source, 'pi-extension/subagents/team-extension.ts'))).default;
const { installArena } = await jiti.import(join(source, 'pi-extension/subagents/team-arena.ts'));
const doneExtension = (await jiti.import(join(source, 'pi-extension/subagents/subagent-done.ts'))).default;
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
  const holds = new Map();
  const retirementAttempts = [];
  const until = async (predicate, label) => { const deadline = Date.now() + 5000; while (!predicate()) { if (Date.now() > deadline) throw new Error(`Deadline: ${label}`); await new Promise(resolve => setTimeout(resolve, 10)); } };
  const hold = id => { let release; const promise = new Promise(resolve => { release = resolve; }); holds.set(id, promise); return () => { holds.delete(id); release(); }; };
  const observed = (id, marker) => (captures.get(id) ?? []).some(c => JSON.stringify(c.messages).includes(marker));
  async function makeSession(id, arenaHooks, autoExit = false) {
    if (autoExit) process.env.PI_SUBAGENT_AUTO_EXIT = '1'; else delete process.env.PI_SUBAGENT_AUTO_EXIT;
    process.env.PI_TEAM_DIR = stateDir;
    process.env.PI_TEAM_MEMBER = id;
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    let api;
    const provider = { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'synthetic', models: [modelSpec], streamSimple: (model, context) => {
      const list = captures.get(id) ?? []; list.push(context); captures.set(id, list);
      const script = scripts.get(id);
      const action = typeof script === 'function' ? script(context) : script?.shift();
      const content = action ? [{ type: 'toolCall', id: `call-${Date.now()}`, name: action.toolName ?? 'team_send', arguments: action.arguments ?? action }] : [{ type: 'text', text: 'done' }];
      const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, stopReason: action ? 'toolUse' : 'stop', timestamp: Date.now(), usage };
      const stream = createAssistantMessageEventStream();
      const gate = holds.get(id);
      queueMicrotask(async () => { if (gate) await gate; stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); });
      return stream;
    } };
    runtime.registerProvider(`fixture-${id}`, provider);
    const skillFile = join(temp, 'arena-SKILL.md'); writeFileSync(skillFile, 'Independent candidates.');
    const loader = new DefaultResourceLoader({ cwd: temp, agentDir: temp, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true,
      skillsOverride: () => ({ skills: [{ name: 'arena', description: 'arena', filePath: skillFile, baseDir: temp, source: 'test' }], diagnostics: [] }),
      extensionFactories: [pi => { api = pi; pi.registerProvider(`fixture-${id}`, provider); if (autoExit) doneExtension(pi); teamExtension(pi); pi.events.on('team:before-exit', () => retirementAttempts.push(id)); if (arenaHooks) installArena(pi, arenaHooks); }],
    });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: temp, agentDir: temp, modelRuntime: runtime, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(temp), model: runtime.getModel(`fixture-${id}`, 'test'), tools: ['read', 'team_send', ...(autoExit ? ['ask_question'] : [])] });
    let shutdowns = 0;
    await session.bindExtensions({ mode: 'print', shutdownHandler: () => { shutdowns++; } });
    sessions.push(session);
    delete process.env.PI_SUBAGENT_AUTO_EXIT;
    return { session, api, get shutdowns() { return shutdowns; } };
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

  await store.send('a', { to: 'orchestrator', message: 'IDLE_ROOT_ACTIVE' });
  await until(() => observed('root', 'IDLE_ROOT_ACTIVE'), 'idle root must wake without a prompt');
  await root.session.waitForIdle();
  assert(root.session.messages.some(m => m.customType === 'team-peer' && m.display && String(m.content).includes('IDLE_ROOT_ACTIVE')));
  for (const id of ['root', 'b']) {
    const release = hold(id);
    const owner = id === 'root' ? root : b;
    let received = false;
    const unsubscribe = owner.api.events.on('team:receipt', m => { if (m.message === `BUSY_${id}`) received = true; });
    const before = captures.get(id)?.length ?? 0;
    const run = owner.session.prompt('busy provider');
    await until(() => (captures.get(id)?.length ?? 0) > before, 'provider running');
    await store.send('a', { to: id === 'root' ? 'orchestrator' : 'bob', message: `BUSY_${id}` });
    await until(() => received, 'peer received while busy');
    unsubscribe();
    release(); await run; await owner.session.waitForIdle();
    assert(observed(id, `BUSY_${id}`));
  }
  const publicMessage = await store.send('a', { to: '#team', message: 'PUBLIC_ACTIVE' });
  await until(() => observed('root', 'PUBLIC_ACTIVE') && observed('b', 'PUBLIC_ACTIVE'), 'public listeners active');
  await Promise.all([root.session.waitForIdle(), b.session.waitForIdle(), a.session.waitForIdle()]);
  assert(!observed('a', 'PUBLIC_ACTIVE'), 'sender must not wake on its own broadcast');
  assert(!store.pending('a', new Set()).some(m => m.id === publicMessage.id));
  const releaseBurst = hold('root');
  const rootRun = root.session.prompt('hold burst');
  await until(() => root.session.isStreaming, 'burst running');
  for (let index = 0; index < 12; index++) await store.send('c', { to: 'orchestrator', message: `BURST_${index}_END` });
  await until(() => receipts.filter(m => m.message.startsWith('BURST_')).length === 12, 'all burst messages queued');
  releaseBurst(); await rootRun; await root.session.waitForIdle();
  for (let index = 0; index < 12; index++) assert(observed('root', `BURST_${index}_END`));
  assert.equal(root.session.messages.filter(m => m.customType === 'team-peer').flatMap(m => m.details.ids).length, new Set(root.session.messages.filter(m => m.customType === 'team-peer').flatMap(m => m.details.ids)).size);

  let answeredQuestion = false;
  scripts.set('b', () => {
    const question = store.messages().find(m => m.message === 'SDK direct question');
    if (!question || answeredQuestion) return;
    answeredQuestion = true;
    return { to: 'alice', message: 'SDK answer', reply_to: question.id };
  });
  scripts.set('a', [{ to: 'bob', message: 'SDK direct question', wait_for_reply: true }]);
  await a.session.prompt('ask now');
  await Promise.all([a.session.waitForIdle(), b.session.waitForIdle(), root.session.waitForIdle()]);
  const answered = a.session.messages.find(m => m.role === 'toolResult' && m.details?.status === 'replied');
  assert(answered);
  assert.match(JSON.stringify(answered.content), /SDK answer/);
  assert(!a.session.messages.some(m => m.customType === 'team-peer' && String(m.content).includes('SDK answer')), 'expected answer appears only in waiting tool result');
  await until(() => observed('root', 'SDK answer'), 'mirrored answer actively delivered');
  assert(observed('root', 'SDK direct question'));

  await Promise.all(sessions.map(s => s.waitForIdle()));
  const releaseStale = hold('root');
  const staleRun = root.session.prompt('stale gate');
  await until(() => root.session.isStreaming, 'stale model running');
  await store.send('c', { to: 'orchestrator', message: 'UNCONSUMED_STALE' });
  await until(() => receipts.some(m => m.message === 'UNCONSUMED_STALE'), 'stale queued');
  root.api.sendMessage({ customType: 'unrelated-control', content: 'PRESERVE_PARENT_STEERING', display: true }, { deliverAs: 'steer' });
  await root.session.prompt('/team off');
  await root.session.prompt('/team on');
  releaseStale(); await staleRun; await root.session.waitForIdle();
  assert(!observed('root', 'UNCONSUMED_STALE'));
  assert(observed('root', 'PRESERVE_PARENT_STEERING'));

  // Both explicit question tools yield to peer context. The fast answerer must
  // remain live after its final response until its own delayed answer arrives.
  await store.register({ id: 'd', name: 'dana', parent: 'root', live: true });
  await store.register({ id: 'e', name: 'erin', parent: 'root', live: true });
  const d = await makeSession('d', undefined, true);
  const e = await makeSession('e', undefined, true);
  let dTurn = 0; let eTurn = 0; let releaseLateAnswer;
  scripts.set('d', () => {
    if (dTurn++ === 0) return { to: 'erin', message: 'QUESTION_D', wait_for_reply: true };
    const question = store.messages().find(m => m.message === 'QUESTION_E');
    if (question && !store.messages().some(m => m.message === 'FAST_ANSWER_D')) return { to: 'erin', message: 'FAST_ANSWER_D', reply_to: question.id };
  });
  scripts.set('e', () => {
    if (eTurn++ === 0) return { to: 'dana', message: 'QUESTION_E', wait_for_reply: true };
    const question = store.messages().find(m => m.message === 'QUESTION_D');
    if (question && !store.messages().some(m => m.message === 'LATE_ANSWER_E')) {
      releaseLateAnswer = hold('e');
      return { to: 'dana', message: 'LATE_ANSWER_E', reply_to: question.id };
    }
  });
  const mutualD = d.session.prompt('mutual question');
  const mutualE = e.session.prompt('mutual question');
  await until(() => store.messages().some(m => m.message === 'FAST_ANSWER_D'), 'fast answer sent');
  await d.session.waitForIdle();
  assert.equal(d.shutdowns, 0, 'interrupted explicit wait prevents early exit');
  assert.equal(store.state().members.d.live, true);
  assert(d.session.messages.some(m => m.role === 'toolResult' && m.details?.status === 'interrupted'));
  await until(() => releaseLateAnswer, 'delayed peer provider is still processing');
  releaseLateAnswer();
  await Promise.all([mutualD, mutualE]);
  await until(() => observed('d', 'LATE_ANSWER_E') && d.shutdowns === 1, 'late answer wakes parked sender then permits exit');
  assert.equal(d.session.messages.filter(m => m.customType === 'team-peer' && String(m.content).includes('LATE_ANSWER_E')).length, 1);

  // The final response reaches retirement while the filesystem lock is held.
  // Receipt then changes seen/queued state before that same retirement acquires it.
  for (const delivery of ['peer', 'parent']) {
    const id = `locked-${delivery}`;
    await store.register({ id, name: id, parent: 'root', live: true });
    const locked = await makeSession(id, undefined, true);
    let responses = 0;
    scripts.set(id, () => {
      if (responses++ > 0) assert.equal(store.state().members[id].live, true, 'Continuation must not run with a retired identity');
    });
    let received = false;
    const unsubscribe = locked.api.events.on('team:receipt', m => { if (m.message === 'LOCKED_PEER_MARKER') received = true; });
    const releaseModel = hold(id);
    const run = locked.session.prompt('prepare final response');
    await until(() => responses === 1, 'locked final provider is running');
    if (delivery === 'peer') await store.send('root', { to: id, message: 'LOCKED_PEER_MARKER' });
    mkdirSync(join(stateDir, 'lock'));
    try {
      const before = retirementAttempts.filter(m => m === id).length;
      releaseModel();
      await until(() => retirementAttempts.filter(m => m === id).length > before, 'retirement waiting on actual lock');
      if (delivery === 'peer') {
        await until(() => received, 'peer queued before lock release');
      } else {
        await locked.session.prompt('LOCKED_PARENT_MARKER', { streamingBehavior: 'steer' });
      }
    } finally { rmSync(join(stateDir, 'lock'), { recursive: true, force: true }); unsubscribe(); }
    await run; await locked.session.waitForIdle();
    assert(observed(id, delivery === 'peer' ? 'LOCKED_PEER_MARKER' : 'LOCKED_PARENT_MARKER'));
    assert.equal(locked.shutdowns, 1);
  }

  const makeParked = async id => {
    await store.register({ id, name: id, parent: 'root', live: true });
    const parked = await makeSession(id, undefined, true);
    scripts.set(id, [{ to: 'alice', message: `DEFERRED_${id}`, wait_for_reply: true }]);
    const run = parked.session.prompt('wait for a reply');
    await until(() => store.messages().some(m => m.message === `DEFERRED_${id}`), 'deferred question sent');
    await store.send('root', { to: id, message: `DEFER_INTERRUPT_${id}` });
    await run; await parked.session.waitForIdle();
    assert.equal(parked.shutdowns, 0);
    return parked;
  };
  const resumed = await makeParked('ask-after-reply');
  let askedAfterReply = false;
  scripts.set('ask-after-reply', context => {
    if (!askedAfterReply && JSON.stringify(context.messages).includes('REPLY_REQUIRES_PARENT')) {
      askedAfterReply = true;
      return { toolName: 'ask_question', arguments: { question: 'Parent decision after peer reply?' } };
    }
  });
  process.env.PI_SUBAGENT_SESSION = join(temp, 'ask-after-reply-session');
  const originalQuestion = store.messages().find(m => m.message === 'DEFERRED_ask-after-reply');
  await store.send('a', { to: 'ask-after-reply', message: 'REPLY_REQUIRES_PARENT', reply_to: originalQuestion.id });
  await until(() => askedAfterReply && existsSync(`${process.env.PI_SUBAGENT_SESSION}.ask`), 'native reply continuation asked parent');
  await resumed.session.waitForIdle();
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(resumed.shutdowns, 0, 'Native agent_start invalidates old deferred retirement; ask_question keeps child alive');
  assert.equal(store.state().members['ask-after-reply'].live, true);
  await resumed.session.prompt('Parent answer received.');
  assert.equal(resumed.shutdowns, 1);
  delete process.env.PI_SUBAGENT_SESSION;

  const timerRace = await makeParked('timer-lock');
  await store.setDesired(false);
  mkdirSync(join(stateDir, 'lock'));
  let parentRun;
  let releaseParent;
  try {
    await new Promise(resolve => setTimeout(resolve, 250));
    releaseParent = hold('timer-lock');
    parentRun = timerRace.session.prompt('PARENT_TURN_DURING_RETIREMENT');
    await until(() => observed('timer-lock', 'PARENT_TURN_DURING_RETIREMENT'), 'new parent turn started while retirement blocked');
  } finally { rmSync(join(stateDir, 'lock'), { recursive: true, force: true }); }
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(timerRace.shutdowns, 0);
  assert.equal(store.state().members['timer-lock'].live, true, 'Deferred timer must recheck actual lifecycle and idle state after lock acquisition');
  releaseParent(); await parentRun;
  assert.equal(timerRace.shutdowns, 1);
  await store.setDesired(true);

  for (const [id, finish] of [['f', 'timeout'], ['g', 'off']]) {
    await store.register({ id, name: id, parent: 'root', live: true });
    const parked = await makeSession(id, undefined, true);
    scripts.set(id, [{ to: 'alice', message: `PARKED_${id}`, wait_for_reply: true }]);
    const run = parked.session.prompt('wait for a reply');
    await until(() => store.messages().some(m => m.message === `PARKED_${id}`), 'parked question sent');
    await store.send('c', { to: id, message: `INTERRUPT_${id}` });
    await run;
    await until(() => parked.session.messages.some(m => m.role === 'toolResult' && m.details?.status === 'interrupted'), 'wait yielded');
    await parked.session.waitForIdle();
    assert.equal(parked.shutdowns, 0);
    if (finish === 'timeout') {
      const realNow = Date.now;
      Date.now = () => realNow() + 61000;
      try { await until(() => parked.shutdowns === 1, 'original deadline wakes parked child exactly once'); }
      finally { Date.now = realNow; }
      assert(parked.session.messages.some(m => m.customType === 'team-peer' && String(m.content).includes('original 60-second deadline')));
      assert.equal(parked.session.messages.filter(m => m.customType === 'team-peer' && String(m.content).includes('original 60-second deadline')).length, 1);
    } else {
      await root.session.prompt('/team off');
      await until(() => parked.shutdowns === 1, 'OFF releases bounded wait and closes parked child without a peer ping');
      assert(!parked.session.messages.some(m => m.customType === 'team-peer' && String(m.content).includes('original 60-second deadline')));
    }
  }
  await Promise.all(sessions.map(s => s.waitForIdle()));
  await root.session.prompt('/team off');
  await b.session.prompt('off propagation');
  assert(!JSON.stringify(captures.get('b').at(-1).tools).includes('team_send'));
  assert(!captures.get('b').at(-1).systemPrompt.includes('team_send'));
  const logBefore = readFileSync(join(stateDir, 'messages.jsonl'), 'utf8');
  await assert.rejects(store.send('a', { to: 'bob', message: 'off rejected' }), /OFF/);
  assert.equal(readFileSync(join(stateDir, 'messages.jsonl'), 'utf8'), logBefore);
  await store.withSuspension(async () => {
    await store.setDesired(true);
    await assert.rejects(store.send('a', { to: 'bob', message: 'suspended rejected' }), /OFF/);
  });
  const gate = {}; b.api.events.emit('team:before-exit', gate); assert(await gate.check);
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
  console.log('PASS team: filesystem routing, root mirror, bounds, identity, generations, nested leases, actual SDK active idle/busy root and peer context, burst delivery, mirrored DMs, visible notifications, no self-wake, mutual waits and bounded parked-child timeout/OFF, active schemas/prompts, stale epoch filtering without clearing parent steering, completed child, arena success/failure/cancel and alias. No network.');
} finally {
  for (const session of sessions) { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); }
  delete process.env.PI_TEAM_DIR; delete process.env.PI_TEAM_MEMBER;
  rmSync(temp, { recursive: true, force: true });
}

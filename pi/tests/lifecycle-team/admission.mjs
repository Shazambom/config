import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [source, directory] = process.argv.slice(2);
const jiti = createJiti(import.meta.url, { alias: { '@sinclair/typebox': import.meta.resolve('typebox').replace('file://', '') } });
const { TeamStore } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const extension = (await jiti.import(join(source, 'pi-extension/subagents/team-extension.ts'))).default;
const owned = { managed: true, status: 'owned', sessionFile: join(directory, 'synthetic-session'), generation: 'first' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(name, initial) {
  const dir = join(directory, name);
  process.env.PI_TEAM_DIR = dir; process.env.PI_TEAM_MEMBER = 'root';
  const handlers = new Map(), commands = new Map(), tools = new Map(), emitter = new EventEmitter();
  let response = initial, active = [], deliveries = 0, entries = 0;
  const api = {
    on: (name, callback) => handlers.set(name, callback),
    events: { on: (name, callback) => { emitter.on(name, callback); return () => emitter.off(name, callback); }, emit: (name, value) => emitter.emit(name, value) },
    registerTool: tool => tools.set(tool.name, tool), registerCommand: (name, command) => commands.set(name, command),
    getActiveTools: () => active, setActiveTools: value => { active = value; },
    sendMessage: () => { deliveries++; }, appendEntry: () => { entries++; },
  };
  emitter.on('session-lifecycle:admission', request => { if (response !== undefined) request.respond(response); });
  const context = { sessionManager: { getSessionId: () => name, getEntries: () => [] }, isIdle: () => true, hasPendingMessages: () => false, shutdown() {}, ui: { notify() {} } };
  extension(api);
  await handlers.get('session_start')({}, context);
  return { dir, handlers, commands, tools, emitter, context, get deliveries() { return deliveries; }, get entries() { return entries; }, get active() { return active; }, set response(value) { response = value; },
    shutdown: () => handlers.get('session_shutdown')({}, context) };
}
for (const status of ['pending', 'conflict', 'stopping', 'unprotected']) {
  const f = await fixture(status, { managed: true, status, reason: 'fixture' });
  try {
    assert(!existsSync(f.dir), `${status}: denied startup must not create shared team state`);
    await f.handlers.get('before_agent_start')({});
    assert.deepEqual(await f.handlers.get('context')({ messages: [{ role: 'user', content: 'ordinary chat' }] }), { messages: [{ role: 'user', content: 'ordinary chat' }] });
    await f.commands.get('team').handler('on', f.context);
    assert(!existsSync(f.dir), `${status}: command must not create shared team state`);
  } finally { await f.shutdown(); }
}
for (const [name, changed] of [
  ['new-generation', { ...owned, generation: 'replacement' }],
  ['new-file', { ...owned, sessionFile: join(directory, 'synthetic-replacement') }],
  ['missing', undefined], ['malformed', { managed: true, status: 'owned' }],
  ['unprotected-after-owned', { managed: true, status: 'unprotected', reason: 'fixture' }],
]) {
  const f = await fixture(name, owned);
  const store = new TeamStore(f.dir);
  const before = store.state();
  f.response = changed;
  try {
    await f.commands.get('team').handler('on', f.context);
    await assert.rejects(f.tools.get('team_send').execute('send', { to: 'peer', message: 'blocked' }), /admission|ownership|unavailable/i);
    const gate = {}; f.emitter.emit('team:before-exit', gate);
    assert.equal(await gate.check, false);
    assert.deepEqual(store.state(), before, `${name}: captured admission must not upgrade or fall back`);
    await f.shutdown();
    before.members.root.live = false;
    before.cancelled = ['root'];
    assert.deepEqual(store.state(), before, `${name}: shutdown may only cancel and retire its captured registration`);
  } finally { await f.shutdown(); }
}
const late = await fixture('legacy-then-managed', undefined);
const lateStore = new TeamStore(late.dir);
const lateBefore = lateStore.state();
try {
  late.response = { managed: true, status: 'pending' };
  await late.handlers.get('before_agent_start')({});
  late.response = undefined;
  await late.commands.get('team').handler('on', late.context);
  assert.deepEqual(lateStore.state(), lateBefore, 'observing managed after legacy permanently disables missing-responder fallback');
  await late.shutdown();
  lateBefore.members.root.live = false;
  lateBefore.cancelled = ['root'];
  assert.deepEqual(lateStore.state(), lateBefore, 'legacy registration still has incarnation-conditional shutdown cleanup');
} finally { await late.shutdown(); }
// Closed admission permits only exact-incarnation cancellation/retirement,
// including after waiting for a replacement writer.
const closed = await fixture('closed-admission-cleanup', owned);
const closedStore = new TeamStore(closed.dir);
closed.response = { managed: true, status: 'stopping' };
try {
  const first = closedStore.state().members.root;
  mkdirSync(join(closed.dir, 'lock'));
  const cleanup = closed.shutdown();
  rmSync(join(closed.dir, 'lock'), { recursive: true });
  // register commits synchronously before the waiting cleanup retries its lock.
  await closedStore.register({ ...first, live: true });
  const replacement = closedStore.state();
  await cleanup;
  assert.deepEqual(closedStore.state(), replacement, 'closed-admission cleanup must compare incarnation inside its transaction');
  assert.notEqual(replacement.members.root.incarnation, first.incarnation);
} finally { rmSync(join(closed.dir, 'lock'), { recursive: true, force: true }); await closed.shutdown(); }
let allowWrites = true;
const guardedStore = TeamStore.create(join(directory, 'closed-store'), () => allowWrites);
const cleanupToken = await guardedStore.register({ id: 'member', name: 'member', parent: null, live: true });
allowWrites = false;
await assert.rejects(guardedStore.register({ id: 'other', name: 'other', parent: null, live: true }), /admission/i);
await assert.rejects(guardedStore.setDesired(true), /admission/i);
await assert.rejects(guardedStore.update('member', { name: 'unauthorized' }), /admission/i);
await assert.rejects(guardedStore.retireIfQuiet('member', cleanupToken, new Set()), /admission/i);
await assert.rejects(guardedStore.cancelTree('member'), /admission/i);
assert.deepEqual(await guardedStore.cancelTree('member', 'stale'), [], 'stale cancellation cannot bypass admission');
assert.equal(guardedStore.state().cancelled.length, 0);
assert.equal((await guardedStore.cancelTree('member', cleanupToken)).length, 1);
assert.equal(await guardedStore.retire('member', cleanupToken), true, 'exact incarnation cleanup remains allowed when admission closes');
assert.equal(guardedStore.state().members.member.live, false);
// Admission must be checked after the real transaction lock is acquired, too.
const raced = await fixture('waiting-transaction', owned);
const racedStore = new TeamStore(raced.dir);
await racedStore.setDesired(true);
await racedStore.register({ id: 'peer', name: 'peer', parent: 'root', live: true });
mkdirSync(join(raced.dir, 'lock'));
try {
  const sending = raced.tools.get('team_send').execute('send', { to: 'peer', message: 'must not commit' });
  raced.response = { ...owned, generation: 'replacement' };
  rmSync(join(raced.dir, 'lock'), { recursive: true });
  await assert.rejects(sending, /admission|ownership|unavailable/i);
  assert.equal(racedStore.messages().length, 0, 'stale admission cannot write after lock wait');
  assert.equal(raced.entries, 0);
} finally { rmSync(join(raced.dir, 'lock'), { recursive: true, force: true }); await raced.shutdown(); }
const paused = await fixture('delivery', owned);
const pausedStore = new TeamStore(paused.dir);
try {
  await pausedStore.setDesired(true);
  await pausedStore.register({ id: 'peer', name: 'peer', parent: 'root', live: true });
  paused.response = { managed: true, status: 'unprotected', reason: 'fixture' };
  await pausedStore.send('peer', { to: 'root', message: 'paused peer context' });
  await delay(250);
  assert.equal(paused.deliveries, 0, 'unprotected automatic delivery stays paused');
  await paused.handlers.get('before_agent_start')({});
  assert(!paused.active.includes('team_send'));
  paused.response = owned;
  await delay(250);
  assert.equal(paused.deliveries, 1, 'same owned receipt can deliver pending peer context');
} finally { await paused.shutdown(); }
console.log('PASS admission startup, stale receipts, fail-closed response loss, transaction race and delivery pause');

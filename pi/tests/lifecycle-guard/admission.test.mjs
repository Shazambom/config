import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';
import { mkdtemp, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';

delete process.env.TMUX; delete process.env.TMUX_PANE;
const jiti = createJiti(import.meta.url);
const guard = (await jiti.import(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url).href)).default;
const { default: consumer, queryAdmission, canWrite } = await jiti.import(new URL('./admission-consumer.ts', import.meta.url).href);
function runtime(events) {
  const handlers = new Map();
  const messages = [];
  const pi = { events, on(event, handler) { const list = handlers.get(event) ?? []; list.push(handler); handlers.set(event, list); }, registerCommand() {}, sendUserMessage: text => messages.push(text) };
  guard(pi); consumer(pi);
  return { messages, async emit(event, data, ctx) { for (const handler of handlers.get(event) ?? []) await handler(data, ctx); } };
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'pi-admission-'));
  const prior = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  const bus = createEventBus();
  let current;
  const file = join(root, 'session.jsonl'); await writeFile(file, '{}\n');
  const ctx = { mode: 'tui', hasUI: true, sessionManager: { getSessionFile: () => file }, ui: { setWidget() {}, setStatus() {}, select: async () => 'Cancel' }, abort() {}, shutdown() {} };
  const load = () => { current = runtime(bus); return current; };
  try { await run({ root, file, bus, ctx, load }); }
  finally {
    await current?.emit('session_shutdown', { reason: 'new' }, ctx);
    bus.clear(); delete globalThis[Symbol.for('portable-pi.admission-consumer-fixture')];
    if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = prior;
    await rm(root, { recursive: true, force: true });
  }
}

test('real event bus synchronously gates a later consumer and retains receipts only for the same owned session', async () => fixture(async ({ root, file, bus, ctx, load }) => {
  const belief = { managed: false };
  assert.equal(queryAdmission(bus, belief).status, 'unmanaged');
  let current = load();
  assert.equal(queryAdmission(bus, belief).status, 'pending');
  await assert.rejects(readFile(join(root, 'admission-ledger.jsonl')), { code: 'ENOENT' });
  await current.emit('session_start', { reason: 'startup' }, ctx);
  const first = queryAdmission(bus, belief);
  assert.equal(first.status, 'owned'); assert.equal(first.sessionFile, await realpath(file)); assert.ok(first.generation);
  assert.equal(canWrite(first), true);
  let returned = false;
  bus.emit('session-lifecycle:admission', { respond: () => { assert.equal(returned, false); } }); returned = true;

  await current.emit('session_shutdown', { reason: 'reload' }, ctx);
  bus.clear(); // Pi invalidates subscriptions when replacing an extension runtime.
  assert.equal(queryAdmission(bus, belief).status, 'unavailable');
  assert.equal(canWrite(queryAdmission(bus, belief), first), false);
  current = load(); await current.emit('session_start', { reason: 'reload' }, ctx);
  assert.equal(canWrite(queryAdmission(bus, belief), first), true);

  const canonicalCtx = { ...ctx, sessionManager: { getSessionFile: () => first.sessionFile } };
  await current.emit('session_shutdown', { reason: 'resume', targetSessionFile: first.sessionFile }, ctx);
  bus.clear(); current = load();
  await current.emit('session_start', { reason: 'resume' }, canonicalCtx);
  assert.equal(canWrite(queryAdmission(bus, belief), first), true, 'canonical same-file resume keeps the receipt');

  const shuttingDown = current.emit('session_shutdown', { reason: 'new' }, canonicalCtx);
  assert.equal(queryAdmission(bus, belief).status, 'stopping');
  await shuttingDown;
  assert.equal(queryAdmission(bus, belief).status, 'stopping');
  bus.clear(); current = load();
  const replacement = join(root, 'replacement.jsonl'); await writeFile(replacement, '{}\n');
  await current.emit('session_start', { reason: 'new' }, { ...ctx, sessionManager: { getSessionFile: () => replacement } });
  const next = queryAdmission(bus, belief);
  assert.equal(next.status, 'owned'); assert.notEqual(next.generation, first.generation);
  assert.equal(canWrite(next, first), false);
  const audit = (await readFile(join(root, 'admission-audit.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(audit.some(row => row.stage === 'shutdown:new' && row.receipt.status === 'stopping' && !row.allowed));
}));

test('a later consumer observes unprotected failure without blocking ordinary input', async () => fixture(async ({ root, bus, ctx, load }) => {
  await writeFile(join(root, '.pi-lifecycle'), 'synthetic failure');
  const current = load(); await current.emit('session_start', { reason: 'startup' }, ctx);
  const reply = queryAdmission(bus, { managed: false });
  assert.equal(reply.status, 'unprotected'); assert.equal(canWrite(reply), false);
  assert.ok(reply.diagnostic); assert.ok(reply.reason);
  await assert.rejects(readFile(join(root, 'admission-ledger.jsonl')), { code: 'ENOENT' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.messages.length, 1);
}));

test('canceled conflict still runs the later startup handler, but cannot authorize its shared write', async () => fixture(async ({ root, file, bus, ctx, load }) => {
  const peer = fork(new URL('../../agent/lifecycle/supervisor.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let startup, cancel;
  try {
    const ready = once(peer, 'message'); peer.send({ type: 'claim', file, pid: process.pid });
    assert.equal((await ready)[0].type, 'owned');
    let entered;
    const dialog = new Promise(resolve => { entered = resolve; });
    ctx.ui.select = () => { entered(); return new Promise(resolve => { cancel = resolve; }); };
    const current = load();
    startup = current.emit('session_start', { reason: 'startup' }, ctx);
    await dialog;
    assert.equal(queryAdmission(bus, { managed: false }).status, 'conflict');
    cancel('Cancel'); await startup;
    assert.equal(queryAdmission(bus, { managed: false }).status, 'stopping');
    const audit = (await readFile(join(root, 'admission-audit.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(audit.some(row => row.stage === 'start:startup' && !row.allowed));
    await assert.rejects(readFile(join(root, 'admission-ledger.jsonl')), { code: 'ENOENT' });
  } finally {
    cancel?.('Cancel'); await startup;
    const exited = once(peer, 'exit'); peer.send({ type: 'release' }); await exited;
  }
}));

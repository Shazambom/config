import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJiti } from 'jiti';
import { createEventBus } from '@earendil-works/pi-coding-agent';

// A private, non-signalling helper drives the real extension's IPC receiver.
test('terminal outage preserves admission, survives reload, and clears automatically without hiding ownership failure', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-monitor-status-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const previousOwner = process.env.PI_LIFECYCLE_OWNER;
  process.env.PI_CODING_AGENT_DIR = directory;
  delete process.env.PI_LIFECYCLE_OWNER;
  const key = Symbol.for('portable-pi.session-lifecycle');
  const handlers = {}, widgets = new Map(), statuses = new Map(), prompts = [];
  const events = createEventBus();
  const pi = { events, on: (name, handler) => { handlers[name] = handler; }, registerCommand() {}, sendUserMessage: message => prompts.push(message) };
  const ctx = { mode: 'tui', hasUI: true, sessionManager: { getSessionFile: () => join(directory, 'session.jsonl') },
    ui: { setWidget: (name, value) => widgets.set(name, value), setStatus: (name, value) => statuses.set(name, value) } };
  const admission = () => { let value; events.emit('session-lifecycle:admission', { respond: result => { value = result; } }); return value; };
  let child;
  try {
    await mkdir(join(directory, 'lifecycle'));
    for (const name of ['session-lifecycle.ts', 'owner-client.mjs']) {
      await copyFile(new URL(`../../agent/lifecycle/${name}`, import.meta.url), join(directory, 'lifecycle', name));
    }
    await writeFile(join(directory, 'lifecycle', 'supervisor.mjs'), `
let file;
process.on('message', message => {
  if (message.type === 'release') process.exit(0);
  if (message.type === 'claim') { file = message.file; process.send({ type: 'owned', sessionFile: file, generation: 'fixture' }); }
  if (message.type === 'test-status') process.send({ type: 'terminal-monitor', sessionFile: file, generation: message.generation ?? 'fixture', available: message.available, code: 'TMUX_QUERY_TIMEOUT' });
  if (message.type === 'test-failure') process.send({ type: 'failure', code: 'LEASE_NOT_READY' });
});
`);
    const factory = (await createJiti(import.meta.url).import(join(directory, 'lifecycle', 'session-lifecycle.ts'))).default;
    factory(pi);
    await handlers.session_start({ reason: 'startup' }, ctx);
    const state = globalThis[key];
    child = state.child;
    child.ref();
    const send = async message => {
      const received = once(child, 'message');
      child.send(message);
      await received;
      await new Promise(resolve => setImmediate(resolve));
    };
    const original = admission();
    assert.equal(original.status, 'owned');
    await send({ type: 'test-status', available: false });
    assert.match(widgets.get('session-terminal-monitor')?.join('\n') ?? '', /Writer lease retained; retrying automatically/);
    assert.deepEqual(admission(), original);
    assert.equal(await handlers.input({}, ctx), undefined);
    assert.equal(prompts.length, 0, 'A temporary outage must not inject an investigation turn');
    await send({ type: 'test-status', available: true, generation: 'stale' });
    assert(widgets.get('session-terminal-monitor'), 'A stale receipt must not clear a current warning');
    await handlers.session_shutdown({ reason: 'reload' }, ctx);
    widgets.clear();
    factory(pi);
    await handlers.session_start({ reason: 'reload' }, ctx);
    assert.equal(globalThis[key].child, child);
    assert(widgets.get('session-terminal-monitor'), 'Reload must restore the temporary warning');
    await send({ type: 'test-status', available: true });
    assert.equal(widgets.get('session-terminal-monitor'), undefined);
    assert.equal(statuses.get('session-terminal-monitor'), undefined);
    assert.deepEqual(admission(), original);
    assert.equal(prompts.length, 0);
    await send({ type: 'test-status', available: false });
    await send({ type: 'test-failure' });
    assert.equal(widgets.get('session-terminal-monitor'), undefined);
    assert.equal(admission().status, 'unprotected');
    // Failure diagnostics are written asynchronously before their UI warning.
    const deadline = Date.now() + 3000;
    while (!widgets.get('session-lifecycle')) {
      assert(Date.now() < deadline, 'Ownership failure warning did not arrive');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(widgets.get('session-lifecycle').join('\n').includes('SESSION UNPROTECTED'));
    await send({ type: 'test-status', available: true });
    assert.equal(admission().status, 'unprotected', 'Terminal recovery must not override a genuine lease failure');
  } finally {
    if (child?.connected) { const exited = once(child, 'exit'); child.send({ type: 'release' }); await exited; }
    delete globalThis[key];
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    if (previousOwner === undefined) delete process.env.PI_LIFECYCLE_OWNER; else process.env.PI_LIFECYCLE_OWNER = previousOwner;
    await rm(directory, { recursive: true, force: true });
  }
});

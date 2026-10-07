import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { createEventBus } from '@earendil-works/pi-coding-agent';
import { mkdtemp, mkdir, copyFile, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';

// Unit runtime must never inspect the operator's terminal.
delete process.env.TMUX;
delete process.env.TMUX_PANE;

const jiti = createJiti(import.meta.url);
const extension = new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url);

test('supervisor loss after reload warns through the fresh runtime rather than silently dropping protection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-loss-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  const handlers = {};
  const warnings = [], messages = [];
  const pi = { on: (event, callback) => { handlers[event] = callback; }, registerCommand() {}, sendUserMessage: content => messages.push(content) };
  const file = join(root, 'session.jsonl');
  const ctx = { mode: 'tui', hasUI: true, sessionManager: { getSessionFile: () => file }, ui: { setWidget() { throw new Error('stale UI context'); }, setStatus() {} } };
  let child;
  pi.events = createEventBus();
  try {
    await writeFile(file, '{}\n');
    const factory = (await jiti.import(extension.href)).default;
    factory(pi);
    await handlers.session_start({ reason: 'startup' }, ctx);
    child = globalThis[Symbol.for('portable-pi.session-lifecycle')].child;
    child.ref();
    await handlers.session_shutdown({ reason: 'reload' }, ctx);
    factory(pi);
    const fresh = { ...ctx, ui: { setWidget: (_name, lines) => warnings.push(lines.join('\n')), setStatus() {} } };
    await handlers.session_start({ reason: 'reload' }, fresh);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    for (let i = 0; i < 50 && !warnings.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(warnings.some(x => x.includes('SESSION UNPROTECTED')));
    assert.equal(messages.length, 1);
    await handlers.session_shutdown({ reason: 'quit' }, fresh);
  } finally {
    if (child?.connected) { const exited = once(child, 'exit'); child.send({ type: 'release' }); await exited; }
    delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
test('support initialization errors redact synthetic secrets from diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-redaction-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  const handlers = {}, warnings = [], messages = [];
  const pi = { on: (event, callback) => { handlers[event] = callback; }, sendUserMessage: message => messages.push(message) };
  const file = join(root, 'session.jsonl');
  const ctx = { mode: 'tui', hasUI: true, sessionManager: { getSessionFile: () => file }, ui: { setWidget: (_name, lines) => warnings.push(lines.join('\n')), setStatus() {} } };
  pi.events = createEventBus();
  try {
    await mkdir(join(root, 'extensions'));
    await mkdir(join(root, 'lifecycle'));
    await writeFile(file, '{}\n');
    await copyFile(extension, join(root, 'extensions', 'guard.ts'));
    await copyFile(new URL('../../agent/lifecycle/owner-client.mjs', import.meta.url), join(root, 'lifecycle', 'owner-client.mjs'));
    await writeFile(join(root, 'lifecycle', 'supervisor.mjs'), `process.on('message', m => { if(m.type === 'release') process.exit(0); else process.send({type:'failure',code:'HELPER_INIT',name:'Error',stack:new Error('SYNTHETIC_SECRET\\n    at SYNTHETIC_SECRET').stack}); });`);
    const factory = (await jiti.import(join(root, 'extensions', 'guard.ts'))).default;
    factory(pi);
    await handlers.session_start({ reason: 'startup' }, ctx);
    assert.ok(warnings.some(x => x.includes('SESSION UNPROTECTED')));
    const [name] = await readdir(join(root, 'lifecycle-diagnostics'));
    assert.ok(!(await readFile(join(root, 'lifecycle-diagnostics', name), 'utf8')).includes('SYNTHETIC_SECRET'));
    assert.equal(messages.length, 1);
    await handlers.session_shutdown({ reason: 'quit' }, ctx);
  } finally {
    delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

for (const scenario of ['missing-client', 'missing', 'broken', 'init-timeout', 'release-timeout', 'conflict-release-timeout', 'switch-release-timeout']) {
  test(`${scenario} is bounded without silently bypassing a conflict`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-guard-handshake-'));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = root;
    const handlers = {}, warnings = [], messages = [];
    let shutdowns = 0, child, startup;
    const ctx = { mode: 'tui', hasUI: true, sessionManager: { getSessionFile: () => join(root, 'session.jsonl') }, shutdown() { shutdowns++; }, abort() {}, ui: {
      setWidget: (_name, lines) => warnings.push(lines.join('\n')), setStatus() {}, select: async () => 'Cancel',
    } };
    const pi = { on: (event, handler) => { handlers[event] = handler; }, sendUserMessage: content => messages.push(content) };
    pi.events = createEventBus();
    try {
      await mkdir(join(root, 'lifecycle'));
      await copyFile(extension, join(root, 'lifecycle', 'guard.ts'));
      if (scenario !== 'missing-client') await copyFile(new URL('../../agent/lifecycle/owner-client.mjs', import.meta.url), join(root, 'lifecycle', 'owner-client.mjs'));
      if (scenario !== 'missing') {
        const source = scenario === 'missing-client' ? `process.on('message', m => { if(m.type === 'release') process.exit(0); else process.send({type:'owned',generation:'fixture-generation',sessionFile:m.file}); });` : scenario === 'broken' ? 'this is not javascript !' :
          scenario === 'init-timeout' ? `process.on('message', () => {});` :
          `process.on('message', m => { if (m.type === 'claim') process.send({type:'${scenario === 'conflict-release-timeout' ? 'conflict' : scenario === 'switch-release-timeout' ? 'owned' : 'failure'}',code:'HELPER_INIT',generation:'fixture-generation',sessionFile:m.file}); });`;
        await writeFile(join(root, 'lifecycle', 'supervisor.mjs'), source);
      }
      const factory = (await jiti.import(join(root, 'lifecycle', 'guard.ts'))).default;
      factory(pi);
      startup = handlers.session_start({ reason: 'startup' }, ctx);
      child = globalThis[Symbol.for('portable-pi.session-lifecycle')].child;
      if (scenario === 'switch-release-timeout') startup = startup.then(async () => {
        const shuttingDown = handlers.session_shutdown({ reason: 'new' }, ctx);
        assert.equal((await handlers.input({}, ctx))?.action, 'handled', 'teardown must close ordinary admission before releasing ownership');
        await shuttingDown;
        factory(pi);
        await handlers.session_start({ reason: 'new' }, ctx);
      });
      let deadline;
      try { await Promise.race([startup, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('startup/release handshake hung')), 4000); })]); }
      finally { clearTimeout(deadline); }
      child ??= globalThis[Symbol.for('portable-pi.session-lifecycle')]?.child;
      child?.ref();
      await new Promise(resolve => setImmediate(resolve));
      if (scenario === 'conflict-release-timeout') {
        assert.equal(messages.length, 0); assert.equal(warnings.length, 0); assert.equal(shutdowns, 1);
        assert.equal((await handlers.input({}, ctx)).action, 'handled');
        // No unbounded before_agent_start promise may prevent requested exit.
        assert.equal(handlers.before_agent_start, undefined);
      } else {
        assert.ok(warnings.some(x => x.includes('SESSION UNPROTECTED')));
        assert.equal(messages.length, 1);
        assert.equal(await handlers.input({}, ctx), undefined);
        await handlers.session_shutdown({ reason: 'reload' }, ctx); factory(pi);
        await handlers.session_start({ reason: 'reload' }, ctx);
        assert.equal(messages.length, 1);
        assert.equal((await readdir(join(root, 'lifecycle-diagnostics'))).length, 1);
      }
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
      await startup?.catch(() => {});
      delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const metadata of [undefined, '{SYNTHETIC_OWNER_SECRET invalid']) {
  test(`free unknown ownership ${metadata === undefined ? 'missing' : 'corrupt'} warns with actionable context and preserves evidence`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-guard-free-unknown-'));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = root;
    const handlers = {}, warnings = [], messages = [];
    const file = join(root, 'session.jsonl');
    const pi = { on: (event, handler) => { handlers[event] = handler; }, sendUserMessage: content => messages.push(content) };
    const ctx = { mode: 'tui', hasUI: true, sessionManager: { getSessionFile: () => file }, ui: {
      setWidget: (_name, lines) => warnings.push(lines.join('\n')), setStatus() {},
      select() { throw new Error('A free unknown lock must not become a Cancel-only conflict'); },
    } };
    pi.events = createEventBus();
    try {
      await writeFile(file, '{}\n');
      const { acquireLease } = await import('../../agent/lifecycle/lease.mjs');
      const { lease } = acquireLease(file);
      lease.publish({ pid: process.pid, started: execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim() });
      lease.release();
      if (metadata === undefined) await rm(lease.metadata); else await writeFile(lease.metadata, metadata);
      const factory = (await jiti.import(extension.href)).default; factory(pi);
      await handlers.session_start({ reason: 'startup' }, ctx);
      assert.ok(warnings.some(line => line.includes('SESSION UNPROTECTED')));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(await handlers.input({}, ctx), undefined);
      assert.equal(messages.length, 1);
      const [name] = await readdir(join(root, 'lifecycle-diagnostics'));
      const raw = await readFile(join(root, 'lifecycle-diagnostics', name), 'utf8');
      const diagnostic = JSON.parse(raw);
      assert.equal(diagnostic.code, 'OWNER_METADATA_UNVERIFIABLE');
      assert.match(diagnostic.reason, /free.*metadata/i);
      assert.match(diagnostic.nextSteps, /do not.*(delete|signal)/i);
      assert.equal(diagnostic.context.sessionFile, file);
      assert.ok(!raw.includes('SYNTHETIC_OWNER_SECRET'));
      if (metadata === undefined) await assert.rejects(readFile(lease.metadata), { code: 'ENOENT' });
      else assert.equal(await readFile(lease.metadata, 'utf8'), metadata);
      await handlers.session_shutdown({ reason: 'reload' }, ctx); factory(pi);
      await handlers.session_start({ reason: 'reload' }, ctx);
      assert.equal(messages.length, 1);
      await handlers.session_shutdown({ reason: 'quit' }, ctx);
    } finally {
      delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('reload before deferred TUI investigation uses only the fresh runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-investigation-reload-'));
  const prior = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root;
  const handlers = {}, messages = [];
  const file = join(root, 'session.jsonl');
  const ctx = { mode: 'tui', hasUI: true, sessionManager: { getSessionFile: () => file }, ui: { setWidget() {}, setStatus() {} } };
  try {
    await writeFile(file, '{}\n'); await writeFile(join(root, '.pi-lifecycle'), 'fixture obstruction');
    const factory = (await jiti.import(extension.href)).default;
    const load = label => factory({ events: createEventBus(), on: (event, fn) => handlers[event] = fn, registerCommand() {}, sendUserMessage: message => messages.push({ label, message }) });
    load('old'); await handlers.session_start({ reason: 'startup' }, ctx);
    assert.equal(messages.length, 0, 'investigation is deferred beyond original startup dispatch');
    await handlers.session_shutdown({ reason: 'reload' }, ctx);
    load('fresh'); await handlers.session_start({ reason: 'reload' }, ctx);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 1); assert.equal(messages[0].label, 'fresh');
    await handlers.session_shutdown({ reason: 'quit' }, ctx);
  } finally {
    delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
    if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test('initialization failure warns persistently, records private diagnostics, and investigates only once across reload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-ui-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  const handlers = {};
  const warnings = [], messages = [];
  const pi = { on: (event, callback) => { handlers[event] = callback; }, registerCommand() {}, sendUserMessage: content => messages.push(content) };
  const file = join(root, 'session.jsonl');
  const ctx = { mode: 'tui', hasUI: true, sessionManager: { getSessionFile: () => file }, ui: {
    setWidget: (_name, lines) => warnings.push(lines.join('\n')),
    setStatus() {}, notify() {}, select() { throw new Error('A failure must not become a blocking conflict dialog'); },
  } };
  pi.events = createEventBus();
  try {
    await writeFile(file, '{}\n');
    await writeFile(join(root, '.pi-lifecycle'), 'not a directory');
    const factory = (await jiti.import(extension.href)).default;
    factory(pi);
    await handlers.session_start({ reason: 'startup' }, ctx);
    assert.ok(warnings.some(x => x.includes('OWNERSHIP PROTECTION FAILED — SESSION UNPROTECTED')));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Investigate/);
    const diagnostics = await readdir(join(root, 'lifecycle-diagnostics'));
    assert.equal(diagnostics.length, 1);
    const diagnostic = JSON.parse(await readFile(join(root, 'lifecycle-diagnostics', diagnostics[0]), 'utf8'));
    assert.ok(diagnostic.code);
    assert.equal(diagnostic.env, undefined);
    await handlers.session_shutdown({ reason: 'reload' }, ctx);
    factory(pi);
    await handlers.session_start({ reason: 'reload' }, ctx);
    assert.equal(messages.length, 1);
    assert.equal((await handlers.input({}, ctx)), undefined, 'fail-open must allow ordinary input');
    await handlers.session_shutdown({ reason: 'quit' }, ctx);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

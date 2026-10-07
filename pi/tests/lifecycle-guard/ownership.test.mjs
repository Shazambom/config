import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createJiti } from 'jiti';
import { createEventBus } from '@earendil-works/pi-coding-agent';
const jiti = createJiti(import.meta.url);
delete process.env.TMUX; delete process.env.TMUX_PANE;

for (const choice of ['Continue here', 'Go to existing session']) {
  test(`${choice} with unreachable known owner retains blocked choice and location until Cancel`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-owner-unreachable-'));
    const handlers = {}, warnings = [], titles = [];
    let selected = false, shutdowns = 0;
    const pi = { events: createEventBus(), on: (name, fn) => handlers[name] = fn, registerCommand() {},
      sendUserMessage() { throw new Error('Conflict must not inject investigation or model work'); } };
    const ctx = { hasUI: true, sessionManager: { getSessionFile: () => join(root, 'session.jsonl') },
      shutdown() { shutdowns++; }, ui: { notify: message => warnings.push(message),
        select: async title => {
          titles.push(title);
          assert.equal(shutdowns, 0);
          assert.equal((await handlers.input({}, ctx)).action, 'handled');
          if (!selected) { selected = true; return choice; }
          return 'Cancel';
        } } };
    try {
      await mkdir(join(root, 'lifecycle'));
      await copyFile(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url), join(root, 'lifecycle', 'guard.ts'));
      await copyFile(new URL('../../agent/lifecycle/owner-client.mjs', import.meta.url), join(root, 'lifecycle', 'owner-client.mjs'));
      await writeFile(join(root, 'lifecycle', 'supervisor.mjs'), `process.on('message', m => {
        if (m.type === 'release') process.exit(0);
        process.send({type:'conflict',sessionFile:m.file,owner:{pid:process.ppid,started:'unknown',generation:'known-generation',location:{socket:'private-unreachable',pane:'%123'}}});
      });`);
      (await jiti.import(join(root, 'lifecycle', 'guard.ts'))).default(pi);
      await handlers.session_start({ reason: 'startup' }, ctx);
      assert.equal(titles.length, 2);
      assert.ok(titles.every(title => title.includes('private-unreachable')));
      assert.match(warnings[0], /Cannot verify or reach/);
      assert.equal(shutdowns, 1);
    } finally { delete globalThis[Symbol.for('portable-pi.session-lifecycle')]; await rm(root, { recursive: true, force: true }); }
  });
}

test('Go existing refuses control-mode clients even when tmux can report the target pane', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-control-client-'));
  const previousPath = process.env.PATH;
  const handlers = {}, warnings = [];
  let owner, helper, choices = 0, shutdowns = 0;
  const file = join(root, 'session.jsonl');
  const stateFile = join(root, 'navigation-attempted');
  const ctx = { hasUI: true, sessionManager: { getSessionFile: () => file }, shutdown() { shutdowns++; },
    ui: { notify: message => warnings.push(message), select: async () => {
      choices++;
      assert.equal(shutdowns, 0, 'control-mode navigation must not exit the contender');
      return choices === 1 ? 'Go to existing session' : 'Cancel';
    } } };
  const pi = { events: createEventBus(), on: (name, fn) => handlers[name] = fn, registerCommand() {}, sendUserMessage() {} };
  try {
    await writeFile(file, '{}\n');
    await writeFile(join(root, 'tmux'), `#!/usr/bin/env bash
case "$*" in
  *list-panes*) printf '%%owner\\t1\\n' ;;
  *switch-client*) : > ${JSON.stringify(stateFile)} ;;
  *list-clients*)
    pane='%contender'; [[ -f ${JSON.stringify(stateFile)} ]] && pane='%owner'
    case "$*" in
      *client_control_mode*) printf 'control-client\\t%s\\t1\\n' "$pane" ;;
      *) printf 'control-client\\t%s\\n' "$pane" ;;
    esac ;;
esac
`, { mode: 0o700 });
    process.env.PATH = `${root}:${previousPath}`;
    const socket = join(root, 'private.sock');
    process.env.TMUX = `${socket},1,0`; process.env.TMUX_PANE = '%contender';
    owner = fork(new URL('./owner-root.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const ready = once(owner, 'message'); owner.send({ type: 'claim', file, terminal: { socket, pane: '%owner' } });
    assert.equal((await ready)[0].type, 'owned');
    (await jiti.import(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url).href)).default(pi);
    await handlers.session_start({ reason: 'startup' }, ctx);
    helper = globalThis[Symbol.for('portable-pi.session-lifecycle')]?.child;
    assert.equal(choices, 2, 'unsupported navigation retains the choice until explicit Cancel');
    assert.equal(shutdowns, 1);
    assert.match(warnings[0], /control-mode.*unsupported/i);
    await assert.rejects(readFile(stateFile), { code: 'ENOENT' });
    process.kill(owner.pid, 0);
  } finally {
    if (helper?.connected) { const done = once(helper, 'exit'); helper.send({ type: 'release' }); await done; }
    if (owner?.connected) { const done = once(owner, 'exit'); owner.disconnect(); await done; }
    delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
    process.env.PATH = previousPath; delete process.env.TMUX; delete process.env.TMUX_PANE;
    await rm(root, { recursive: true, force: true });
  }
});

for (const managed of [true, false]) for (const outcome of ['fresh', 'cancelled', 'other-session', 'stop']) test(`deferred ${managed ? 'worker' : 'root'} startup task is scoped and completed for ${outcome}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-startup-replay-'));
  const priorOwner = process.env.PI_LIFECYCLE_OWNER;
  if (managed) process.env.PI_LIFECYCLE_OWNER = '{}'; else delete process.env.PI_LIFECYCLE_OWNER;
  const handlers = {}, commands = {}, sent = [];
  const file = join(root, 'session.jsonl');
  let helper, input;
  const ctx = { hasUI: true, sessionManager: { getSessionFile: () => file }, abort() {}, shutdown() {}, ui: { notify() {} } };
  const pi = { events: createEventBus(), on: (event, fn) => handlers[event] = fn, registerCommand: (name, value) => commands[name] = value, sendUserMessage() {} };
  try {
    await mkdir(join(root, 'lifecycle')); await writeFile(file, '{}\n');
    await copyFile(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url), join(root, 'lifecycle', 'guard.ts'));
    await copyFile(new URL('../../agent/lifecycle/owner-client.mjs', import.meta.url), join(root, 'lifecycle', 'owner-client.mjs'));
    await writeFile(join(root, 'lifecycle', 'supervisor.mjs'), `process.on('message', m => { if(m.type === 'release') process.exit(0); else process.send({type:'owned',recovered:true,sessionFile:m.file,generation:'fixture-generation'}); });`);
    (await jiti.import(join(root, 'lifecycle', 'guard.ts'))).default(pi);
    await handlers.session_start({ reason: 'startup' }, ctx);
    helper = globalThis[Symbol.for('portable-pi.session-lifecycle')].child; helper.ref();
    await handlers.input({ source: 'extension', text: 'must not replay extension input' }, ctx);
    await handlers.input({ source: 'interactive', text: 'must not replay another session' }, { ...ctx, sessionManager: { getSessionFile: () => file + '.other' } });
    const image = { type: 'image', data: 'original-image', mimeType: 'image/png' };
    let completed = false;
    input = handlers.input({ source: 'interactive', text: 'first supplied task', images: [image] }, ctx).then(value => { completed = true; return value; });
    image.data = 'changed-after-capture';
    assert.equal(completed, false);
    await handlers.input({ source: 'interactive', text: 'later input must not be queued' }, ctx);
    if (outcome === 'stop') await globalThis[Symbol.for('portable-pi.session-lifecycle')].onMessage({ type: 'stop' });
    const command = commands['lifecycle-fresh-owner'];
    await command.handler('', { ...ctx, switchSession: async (_file, options) => {
      if (outcome === 'cancelled') return { cancelled: true };
      if (outcome === 'other-session') {
        await handlers.session_shutdown({ reason: 'new', targetSessionFile: file + '.other' }, ctx);
        await options.withSession({ ...ctx, sessionManager: { getSessionFile: () => file + '.other' }, sendUserMessage: value => sent.push(value) });
        return { cancelled: false };
      }
      await handlers.session_shutdown({ reason: 'resume', targetSessionFile: file }, ctx);
      await handlers.session_start({ reason: 'resume', previousSessionFile: file }, ctx);
      const fresh = { ...ctx, sendUserMessage: async value => sent.push(value) };
      await options.withSession(fresh);
      await options.withSession(fresh); // A repeated callback must not replay twice.
      return { cancelled: false };
    } });
    let timer;
    try { assert.equal((await Promise.race([input, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deferred startup input never completed')), 1000); })])).action, 'handled'); }
    finally { clearTimeout(timer); }
    if (outcome === 'fresh') assert.deepEqual(sent, [[{ type: 'text', text: 'first supplied task' }, { type: 'image', data: 'original-image', mimeType: 'image/png' }]]);
    else assert.deepEqual(sent, []);
  } finally {
    const state = globalThis[Symbol.for('portable-pi.session-lifecycle')];
    if (state?.child === helper) state.child = undefined; // Intentional fixture cleanup, not supervisor loss.
    await handlers.session_shutdown?.({ reason: 'quit' }, ctx);
    if (helper?.connected) { const done = once(helper, 'exit'); helper.send({ type: 'release' }); await done; }
    delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
    if (priorOwner === undefined) delete process.env.PI_LIFECYCLE_OWNER; else process.env.PI_LIFECYCLE_OWNER = priorOwner;
    await rm(root, { recursive: true, force: true });
  }
});

test('uncertain live contender helper is retired before retrying with a new helper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-uncertain-contender-'));
  const handlers = {}, warnings = [];
  const file = join(root, 'session.jsonl'), starts = join(root, 'helpers'), claims = join(root, 'claims');
  let helper, choices = 0;
  const ctx = { hasUI: true, sessionManager: { getSessionFile: () => file }, ui: { select: async () => { choices++; return 'Continue here'; }, notify: message => warnings.push(message) } };
  const pi = { events: createEventBus(), on: (event, fn) => handlers[event] = fn, registerCommand() {}, sendUserMessage() {} };
  try {
    await mkdir(join(root, 'lifecycle')); await writeFile(file, '{}\n');
    await copyFile(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url), join(root, 'lifecycle', 'guard.ts'));
    await writeFile(join(root, 'lifecycle', 'owner-client.mjs'), 'export async function ownerRequest() {}');
    await writeFile(join(root, 'lifecycle', 'supervisor.mjs'), `import {appendFileSync,existsSync} from 'node:fs';
      const starts=${JSON.stringify(starts)}, claims=${JSON.stringify(claims)};
      const first=!existsSync(starts); appendFileSync(starts,process.pid+'\\n'); let count=0;
      process.on('message', m=>{ if(m.type==='release')process.exit(0); if(m.type!=='claim')return;
        appendFileSync(claims,process.pid+'\\n'); count++;
        if(first && count===1) process.send({type:'conflict',sessionFile:m.file,owner:{generation:'old'}});
        else if(first) {} // Unknown result: still alive, but must never receive another claim.
        else process.send({type:'owned',sessionFile:m.file,generation:'new'});
      });`);
    (await jiti.import(join(root, 'lifecycle', 'guard.ts'))).default(pi);
    await handlers.session_start({ reason: 'startup' }, ctx);
    helper = globalThis[Symbol.for('portable-pi.session-lifecycle')].child; helper.ref();
    const pids = (await readFile(starts, 'utf8')).trim().split('\n');
    assert.equal(pids.length, 2);
    assert.deepEqual((await readFile(claims, 'utf8')).trim().split('\n'), [pids[0], pids[0], pids[1]]);
    assert.equal(choices, 2);
    assert.equal(warnings.length, 1);
    assert.throws(() => process.kill(Number(pids[0]), 0), { code: 'ESRCH' });
  } finally {
    const state = globalThis[Symbol.for('portable-pi.session-lifecycle')];
    if (state?.child === helper) state.child = undefined;
    await handlers.session_shutdown?.({ reason: 'quit' }, ctx);
    if (helper?.connected) { const done = once(helper, 'exit'); helper.send({ type: 'release' }); await done; }
    delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
    await rm(root, { recursive: true, force: true });
  }
});

for (const outcome of ['fresh', 'stopping']) test(`Continue here retires actual owner and fences ${outcome} context`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-continue-'));
  const file = join(root, 'session.jsonl'); await writeFile(file, '{}\n');
  const owner = fork(new URL('./owner-root.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = once(owner, 'exit');
  let helper, counting;
  const helperPids = new Set();
  const handlers = {}, commands = {}, messages = [], choices = [];
  const pi = { events: createEventBus(), on: (name, fn) => handlers[name] = fn,
    registerCommand: (name, command) => commands[name] = command,
    sendUserMessage: (...args) => messages.push(args) };
  const ctx = { hasUI: true, sessionManager: { getSessionFile: () => file }, abort() {}, shutdown() {},
    ui: { select: async (_title, options) => { choices.push(options); return 'Continue here'; }, notify() {}, setWidget() {}, setStatus() {} } };
  try {
    const ready = once(owner, 'message'); owner.send({ type: 'claim', file }); await ready;
    if (outcome === 'fresh') owner.kill('SIGSTOP');
    counting = setInterval(() => { const pid = globalThis[Symbol.for('portable-pi.session-lifecycle')]?.child?.pid; if (pid) helperPids.add(pid); }, 10);
    const factory = (await jiti.import(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url).href)).default;
    factory(pi); await handlers.session_start({ reason: 'startup' }, ctx);
    helper = globalThis[Symbol.for('portable-pi.session-lifecycle')]?.child;
    helper?.ref();
    if (helper?.pid) helperPids.add(helper.pid);
    clearInterval(counting);
    assert.equal(helperPids.size, 1, 'bounded takeover retries must retain the same known-unowned contender helper');
    assert.deepEqual(choices[0], ['Continue here', 'Go to existing session', 'Cancel']);
    await exited;
    assert.equal((await handlers.input({}, ctx)).action, 'handled');
    assert.equal(messages.length, 0, 'fresh command must not start replacement inside the original startup dispatch');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 1);
    assert.equal(messages[0][1].expandPromptTemplates, true);
    const name = messages[0][0].slice(1);
    const generation = globalThis[Symbol.for('portable-pi.session-lifecycle')].generation;
    await handlers.session_start({ reason: 'resume', previousSessionFile: file }, ctx);
    assert.equal((await handlers.input({}, ctx))?.action, 'handled', 'an unrequested same-file resume cannot authorize startup');
    await handlers.session_shutdown({ reason: 'reload' }, ctx);
    factory(pi);
    await handlers.session_start({ reason: 'reload' }, ctx);
    assert.equal((await handlers.input({}, ctx))?.action, 'handled', 'ordinary reload cannot bypass fresh-context admission');
    assert.equal(globalThis[Symbol.for('portable-pi.session-lifecycle')].generation, generation);
    assert.ok(commands[name]);
    await commands[name].handler('', { ...ctx, switchSession: async () => ({ cancelled: true }) });
    assert.equal((await handlers.input({}, ctx)).action, 'handled', 'cancelled fresh reload cannot admit stale context');
    await commands[name].handler('', { ...ctx, switchSession: async (target, options) => {
      assert.equal(target, file);
      assert.equal(await handlers.session_before_switch({ reason: 'resume', targetSessionFile: file }, ctx), undefined);
      await handlers.session_start({ reason: 'resume', previousSessionFile: file }, ctx);
      assert.equal((await handlers.input({}, ctx))?.action, 'handled', 'expected shutdown must precede fresh startup');
      await handlers.session_shutdown({ reason: 'resume', targetSessionFile: file }, ctx);
      await handlers.session_start({ reason: 'reload' }, ctx);
      assert.equal((await handlers.input({}, ctx))?.action, 'handled', 'reload is not the expected replacement');
      await handlers.session_start({ reason: 'resume', previousSessionFile: file + '.different' }, ctx);
      assert.equal((await handlers.input({}, ctx))?.action, 'handled', 'previous file must match the expected replacement');
      if (outcome === 'stopping') await globalThis[Symbol.for('portable-pi.session-lifecycle')].onMessage({ type: 'stop' });
      await handlers.session_start({ reason: 'resume', previousSessionFile: file }, ctx);
      let startupAdmission; pi.events.emit('session-lifecycle:admission', { respond: value => startupAdmission = value });
      assert.equal(startupAdmission.status, outcome === 'fresh' ? 'owned' : 'stopping', 'later startup consumers must see ownership before command completion');
      await options?.withSession?.(ctx);
      return { cancelled: false };
    } });
    if (outcome === 'stopping') {
      assert.equal((await handlers.input({}, ctx))?.action, 'handled', 'a late fresh callback cannot reopen a stopping root');
      return;
    }
    assert.equal(await handlers.input({}, ctx), undefined);
    let admission; pi.events.emit('session-lifecycle:admission', { respond: value => admission = value });
    assert.equal(admission.status, 'owned');
  } finally {
    clearInterval(counting);
    if (owner.connected) owner.disconnect();
    if (helper?.connected) { const done = once(helper, 'exit'); helper.send({ type: 'release' }); await done; }
    delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
    await rm(root, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import installShell from '../../agent/wakeups/shell.mjs';

const definition = JSON.parse(readFileSync(new URL('../wakeups-sandbox/interface-v1.json', import.meta.url))).tools.find(t => t.name === 'watch_shell');
export function fixture(getShellConfig = () => ({ shell: '/bin/sh', args: ['-c'] })) {
  const handlers = new Map(), messages = [], warnings = [];
  let tool, token = {}, owned = true;
  const owner = { sessionFile: '/private-fixture', generation: 'fixture' };
  const pi = {
    on(name, fn) { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); },
    registerTool(value) { tool = value; },
    sendMessage(message, options) { messages.push({ message, options }); },
  };
  const lifecycle = { readOwner: () => owned ? owner : undefined, getIncarnation: () => token,
    isCurrent: (o, i) => owned && o === owner && i === token };
  const emit = async (name, event = {}) => { for (const fn of handlers.get(name) || []) await fn(event); };
  installShell(pi, definition, lifecycle, { getShellConfig });
  const ctx = { mode: 'tui', cwd: process.cwd(), ui: { notify: text => warnings.push(text) } };
  return { messages, warnings, emit, ctx, loseOwner() { owned = false; }, replace() { token = {}; },
    launch: (command, callId = 'call') => tool.execute(callId, { command, on_exit: 'report outcome' }, undefined, undefined, ctx),
    commit: (details, toolCallId = 'call') => emit('message_end', { message: { role: 'toolResult', toolName: 'watch_shell', toolCallId, details, isError: false } }),
  };
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const nodeCommand = code => `${quote(process.execPath)} -e ${quote(code)}`;
async function until(fn, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!fn()) { if (Date.now() > deadline) assert.fail('condition deadline'); await delay(10); }
}
for (const [command, termination] of [['exit 0', { exit_code: 0 }], ['exit 7', { exit_code: 7 }], ['exit 137', { exit_code: 137 }], ['kill -TERM $$', { signal: 'SIGTERM' }]]) {
  test(`actual ${command}, receipt before exit`, async t => {
    const f = fixture(); t.after(() => f.emit('session_shutdown'));
    const receipt = await f.launch(command);
    assert.deepEqual(Object.keys(receipt.details).sort(), ['process_id', 'status']);
    assert.equal(receipt.details.status, 'running');
    await delay(400);
    assert.equal(f.messages.length, 0);
    await f.commit(receipt.details, 'wrong-call');
    assert.equal(f.messages.length, 0);
    await f.commit(receipt.details);
    assert.equal(f.messages.length, 1, 'matching public message_end releases the already completed result');
    await until(() => f.messages.length === 1);
    const { message, options } = f.messages[0];
    assert.deepEqual(options, { triggerTurn: true, deliverAs: 'followUp' });
    assert.deepEqual(message.details.termination, termination);
    assert.equal(message.details.process_id, receipt.details.process_id);
    assert.equal(message.details.stdout_tail, '');
    assert.equal(message.details.stderr_tail, '');
    assert.equal(message.details.output_incomplete, false);
  });
}
test('huge separate output streams retain bounded suffixes and drain without blocking', async t => {
  const f = fixture(); t.after(() => f.emit('session_shutdown'));
  const receipt = await f.launch(nodeCommand(`const fs=require('fs');fs.writeSync(1,'a'.repeat(2000000)+'OUT');fs.writeSync(2,'b'.repeat(3000000)+'ERR');`));
  await f.commit(receipt.details);
  await until(() => f.messages.length === 1);
  const e = f.messages[0].message.details;
  assert.equal(e.stdout_tail, 'a'.repeat(4093) + 'OUT');
  assert.equal(e.stderr_tail, 'b'.repeat(4093) + 'ERR');
  assert.equal(e.stdout_dropped_bytes, 2000003 - 4096);
  assert.equal(e.stderr_dropped_bytes, 3000003 - 4096);
  assert.equal(e.output_incomplete, false);
});
test('split UTF8 is decoded only after collection and tails remain byte bounded', async t => {
  const f = fixture(); t.after(() => f.emit('session_shutdown'));
  const receipt = await f.launch(nodeCommand(`const fs=require('fs'); const b=Buffer.from('€'.repeat(2000));for(let i=0;i<b.length;i++){fs.writeSync(1,b.subarray(i,i+1));fs.writeSync(2,b.subarray(i,i+1));}`));
  await f.commit(receipt.details);
  await until(() => f.messages.length === 1);
  const e = f.messages[0].message.details;
  for (const stream of ['stdout', 'stderr']) {
    assert.equal(e[`${stream}_tail`], '€'.repeat(1365));
    assert.equal(e[`${stream}_dropped_bytes`], 6000 - 4095);
    assert.ok(Buffer.byteLength(e[`${stream}_tail`]) <= 4096);
  }
});
test('held descendant pipes produce bounded incomplete result after actual shell exit', async t => {
  const f = fixture(); t.after(() => f.emit('session_shutdown'));
  const start = Date.now();
  const receipt = await f.launch('sleep 30 & exit 7');
  await f.commit(receipt.details);
  await until(() => f.messages.length === 1, 2000);
  assert.deepEqual(f.messages[0].message.details.termination, { exit_code: 7 });
  assert.equal(f.messages[0].message.details.output_incomplete, true);
  assert.ok(Date.now() - start < 2000);
});
test('reserve capacity before asynchronous preparation; stale owner cannot launch', async t => {
  let release;
  const config = new Promise(resolve => { release = resolve; });
  const f = fixture(() => config); t.after(() => f.emit('session_shutdown'));
  const pending = Array.from({ length: 8 }, (_, i) => f.launch('exit 0', `call-${i}`));
  // Attach handlers before invalidating owner, avoiding transient unhandled rejection.
  const failures = pending.map(p => assert.rejects(p, /^Error: LAUNCH_FAILED$/));
  await assert.rejects(f.launch('exit 0', 'overflow'), /CAPACITY_REACHED/);
  f.loseOwner();
  release({ shell: '/bin/sh', args: ['-c'] });
  await Promise.all(failures);
  assert.deepEqual(f.messages, []);
});
test('shutdown synchronously invalidates an in-flight launch', async () => {
  let release;
  const f = fixture(() => new Promise(resolve => { release = resolve; }));
  const pending = assert.rejects(f.launch('exit 0'), /^Error: LAUNCH_FAILED$/);
  await f.emit('session_shutdown');
  release({ shell: '/bin/sh', args: ['-c'] });
  await pending;
  assert.deepEqual(f.messages, []);
});
test('new runtime incarnation cannot publish a prior completed result', async t => {
  const f = fixture(); t.after(() => f.emit('session_shutdown'));
  const receipt = await f.launch('exit 7');
  await delay(300);
  f.replace();
  await f.commit(receipt.details);
  await delay(100);
  assert.deepEqual(f.messages, []);
});
test('helper never executes inherited NODE_OPTIONS hooks; launched command preserves them', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'wakeups-shell-options-'));
  const marker = join(directory, 'loaded');
  const preload = join(directory, 'preload.cjs');
  writeFileSync(preload, `require('node:fs').appendFileSync(${JSON.stringify(marker)}, process.pid+'\\n')`);
  const old = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `--require=${preload}`;
  t.after(() => { if (old === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = old; rmSync(directory, { recursive: true, force: true }); });
  const f = fixture(); t.after(() => f.emit('session_shutdown'));
  const receipt = await f.launch(nodeCommand(`process.stdout.write(String(process.pid))`));
  await f.commit(receipt.details);
  await until(() => f.messages.length === 1);
  const loaded = readFileSync(marker, 'utf8').trim().split('\n');
  assert.deepEqual(loaded, [f.messages[0].message.details.stdout_tail]);
});
test('invalid shell selection fails safely before any helper launch', async t => {
  const f = fixture(() => null); t.after(() => f.emit('session_shutdown'));
  await assert.rejects(f.launch('exit 0'), /^Error: LAUNCH_FAILED$/);
  assert.deepEqual(f.messages, []);
});
function failHelperSpawn(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wakeups-shell-fork-failure-'));
  const original = childProcess.fork;
  const events = [];
  childProcess.fork = (modulePath, args, options) => {
    // Exercise the real Node failed-spawn lifecycle, not a shell exit or a
    // synthetic result. No OS child exists when execPath cannot be opened.
    const helper = original(modulePath, args, { ...options, execPath: join(directory, 'missing-node') });
    const sequence = [];
    events.push(sequence);
    for (const event of ['spawn', 'error', 'exit', 'close']) helper.on(event, () => sequence.push(event));
    return helper;
  };
  syncBuiltinESMExports();
  const restore = () => { childProcess.fork = original; syncBuiltinESMExports(); };
  t.after(() => { restore(); rmSync(directory, { recursive: true, force: true }); });
  return { events, restore };
}
test('helper fork error/close without exit releases all capacity for a real subsequent launch', async t => {
  const fault = failHelperSpawn(t);
  const f = fixture(); t.after(() => f.emit('session_shutdown'));
  for (let i = 0; i < 8; i++) await assert.rejects(f.launch('exit 0', `failed-${i}`), /^Error: LAUNCH_FAILED$/);
  assert.ok(fault.events.every(sequence => sequence.includes('error') && !sequence.includes('exit')));
  assert.deepEqual(f.messages, []);
  fault.restore();
  const receipt = await f.launch('exit 7');
  assert.deepEqual(fault.events, Array.from({ length: 8 }, () => ['error', 'close']));
  await f.commit(receipt.details);
  await until(() => f.messages.length === 1);
  assert.deepEqual(f.messages[0].message.details.termination, { exit_code: 7 });
  await f.emit('session_shutdown');
  assert.deepEqual(f.warnings, []);
});
test('an IPC error on a spawned helper does not finalize or forget the live process', async t => {
  const original = childProcess.fork;
  let helper;
  childProcess.fork = (...args) => { helper = original(...args); return helper; };
  syncBuiltinESMExports();
  const f = fixture();
  t.after(async () => {
    childProcess.fork = original; syncBuiltinESMExports();
    // Even a failing regression must clean up its private process group.
    if (helper?.connected) { helper.send({ type: 'stop' }, () => {}); helper.disconnect(); }
    if (helper) await until(() => helper.exitCode !== null || helper.signalCode !== null);
    await f.emit('session_shutdown');
  });
  await f.launch('sleep 30');
  childProcess.fork = original; syncBuiltinESMExports();
  assert.ok(helper.pid > 0);
  assert.equal(helper.exitCode, null);
  assert.equal(helper.signalCode, null);
  helper.emit('error', new Error('fixture IPC failure'));
  await f.emit('session_shutdown');
  assert.ok(helper.exitCode !== null || helper.signalCode !== null, 'shutdown waited for the actual live helper exit');
  assert.deepEqual(f.messages, []);
  assert.deepEqual(f.warnings, []);
});
test('failed helper spawn shutdown is prompt and does not claim supervision loss', async t => {
  const fault = failHelperSpawn(t);
  const f = fixture(); t.after(() => f.emit('session_shutdown'));
  await assert.rejects(f.launch('exit 0'), /^Error: LAUNCH_FAILED$/);
  assert.ok(fault.events[0].includes('error') && !fault.events[0].includes('exit'));
  const start = performance.now();
  await f.emit('session_shutdown');
  assert.ok(performance.now() - start < 500, 'no timeout for a helper that never spawned');
  assert.deepEqual(f.warnings, []);
  assert.deepEqual(f.messages, []);
});
test('spawn failure is ordinary safe error without receipt or event', async t => {
  const f = fixture(() => ({ shell: '/no-such-fixture-shell', args: ['-c'] }));
  t.after(() => f.emit('session_shutdown'));
  await assert.rejects(f.launch('exit 0'), /^Error: LAUNCH_FAILED$/);
  await delay(300);
  assert.deepEqual(f.messages, []);
});

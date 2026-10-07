import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:net';

const supervisor = new URL('../../agent/lifecycle/supervisor.mjs', import.meta.url);
async function start(root, file, pid = process.pid) {
  const child = fork(supervisor, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const answer = new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('exit', code => reject(new Error(`Supervisor exited ${code}: ${stderr}`)));
  });
  child.send({ type: 'claim', root, file, pid });
  return { child, result: await answer };
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.send({ type: 'release' });
  await exited;
}

test('simultaneous claims have exactly one owner; aliases conflict; release permits replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-test-'));
  const children = [];
  try {
    const file = join(root, 'session.jsonl');
    await writeFile(file, '{}\n');
    const alias = join(root, 'alias.jsonl');
    await symlink(file, alias);
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => start(root, i % 2 ? file : alias)));
    children.push(...claims.map(x => x.child));
    assert.equal(claims.filter(x => x.result.type === 'owned').length, 1);
    assert.equal(claims.filter(x => x.result.type === 'conflict').length, 7);
    const winner = claims.find(x => x.result.type === 'owned');
    await stop(winner.child);
    const replacement = await start(root, file);
    children.push(replacement.child);
    assert.equal(replacement.result.type, 'owned');
    // Late release by a losing generation must not remove the replacement.
    for (const loser of claims.filter(x => x !== winner)) await stop(loser.child);
    const late = await start(root, file);
    children.push(late.child);
    assert.equal(late.result.type, 'conflict');
  } finally {
    for (const child of children) await stop(child);
    await rm(root, { recursive: true, force: true });
  }
});

test('missing lease metadata cannot hang release or turn unknown ownership into takeover', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-corrupt-'));
  let child;
  try {
    const file = join(root, 'session.jsonl');
    await writeFile(file, '{}\n');
    ({ child } = await start(root, file));
    const [metadata] = (await readdir(join(root, '.pi-lifecycle'))).filter(name => name.endsWith('.owner.json'));
    await rm(join(root, '.pi-lifecycle', metadata));
    const contender = await start(root, file);
    assert.equal(contender.result.type, 'conflict');
    await stop(contender.child);
    const exit = once(child, 'exit');
    child.send({ type: 'release' });
    let timer;
    try {
      await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('release hung')), 1000); })]);
    } finally { clearTimeout(timer); }
    assert.equal((await readdir(join(root, '.pi-lifecycle'))).filter(name => name.endsWith('.sqlite')).length, 1, 'lock database remains stable after release');
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await rm(root, { recursive: true, force: true });
  }
});

test('different agent directories cannot bypass the supervisor lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-cross-dir-'));
  const children = [];
  try {
    const file = join(root, 'session.jsonl'); await writeFile(file, '{}\n');
    const first = await start(join(root, 'agent-a'), file); children.push(first.child);
    const second = await start(join(root, 'agent-b'), file); children.push(second.child);
    assert.equal(first.result.type, 'owned'); assert.equal(second.result.type, 'conflict');
  } finally { for (const child of children) await stop(child); await rm(root, { recursive: true, force: true }); }
});

test('actual supervisor death retains live-root recovery state and cannot grant a contender', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-supervisor-death-'));
  let first, second;
  try {
    const file = join(root, 'session.jsonl'); await writeFile(file, '{}\n');
    first = await start(root, file); assert.equal(first.result.type, 'owned');
    const exited = once(first.child, 'exit'); first.child.kill('SIGKILL'); await exited;
    process.kill(process.pid, 0);
    second = await start(root, file);
    assert.equal(second.result.type, 'conflict'); assert.equal(second.result.reason, 'recovery');
    assert.equal(second.result.owner.pid, process.pid);
  } finally {
    if (second) await stop(second.child);
    if (first?.child.connected) await stop(first.child);
    await rm(root, { recursive: true, force: true });
  }
});

test('disconnect during initialization exits promptly instead of publishing a late owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-disconnect-'));
  const child = fork(supervisor, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    const file = join(root, 'session.jsonl'); await writeFile(file, '{}\n');
    const exited = once(child, 'exit');
    child.send({ type: 'claim', root, file, pid: process.pid }); child.disconnect();
    let deadline;
    try { await Promise.race([exited, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('disconnect hung')), 1500); })]); }
    finally { clearTimeout(deadline); }
    let entries = [];
    try { entries = await readdir(join(root, '.pi-lifecycle')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of entries.filter(name => name.endsWith('.owner.json'))) {
      assert.notEqual(JSON.parse(await readFile(join(root, '.pi-lifecycle', name), 'utf8')).status, 'active');
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await rm(root, { recursive: true, force: true });
  }
});

test('only the direct parent may be registered as root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-parent-'));
  try {
    const file = join(root, 'session.jsonl');
    await writeFile(file, '{}\n');
    const { child, result } = await start(root, file, 1);
    try { assert.equal(result.type, 'failure'); assert.equal(result.code, 'ROOT_NOT_PARENT'); }
    finally { await stop(child); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function ownerRequest(owner, message) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: owner.port });
    socket.setTimeout(1500, () => socket.destroy(new Error('owner request timeout')));
    socket.on('error', reject);
    let text = '';
    socket.on('data', data => { text += data; });
    socket.on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    socket.on('connect', () => socket.end(JSON.stringify(message) + '\n'));
  });
}

test('owner endpoint binds retirement to exact file and generation and only retires its own root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-owner-endpoint-'));
  const file = join(root, 'session.jsonl'); await writeFile(file, '{}\n');
  const owner = fork(new URL('./owner-root.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let contender;
  try {
    const ready = once(owner, 'message'); owner.send({ type: 'claim', file });
    assert.equal((await ready)[0].type, 'owned');
    contender = await start(root, file);
    const metadata = contender.result.owner;
    assert.equal(typeof metadata.port, 'number');
    const request = { action: 'probe', file: await realpath(file), generation: metadata.generation };
    assert.equal((await ownerRequest(metadata, request)).type, 'owner');
    for (const invalid of [{ ...request, action: 'stop', generation: 'stale' }, { ...request, action: 'stop', file: file + '.other' }]) {
      assert.equal((await ownerRequest(metadata, invalid)).type, 'refused');
      process.kill(owner.pid, 0);
    }
    const exited = once(owner, 'exit');
    assert.equal((await ownerRequest(metadata, { ...request, action: 'stop' })).type, 'owner');
    await exited;
    await stop(contender.child);
    // Root death can precede helper disconnect processing; retry only contention.
    for (let i = 0; i < 30; i++) {
      contender = await start(root, file);
      if (contender.result.type === 'owned') break;
      await stop(contender.child); await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(contender.result.type, 'owned');
  } finally {
    if (owner.connected) { const exited = once(owner, 'exit'); owner.disconnect(); await exited; }
    if (contender) await stop(contender.child);
    await rm(root, { recursive: true, force: true });
  }
});

test('infrastructure failure differs from conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-guard-error-'));
  try {
    const file = join(root, 'session.jsonl');
    await writeFile(file, '{}\n');
    await writeFile(join(root, '.pi-lifecycle'), 'not a directory');
    const { child, result } = await start(root, file);
    try { assert.equal(result.type, 'failure'); assert.equal(result.code, 'EEXIST'); }
    finally { await stop(child); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

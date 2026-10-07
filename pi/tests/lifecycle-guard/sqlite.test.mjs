import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, stat, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork, spawn as spawnProcess, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const fixture = new URL('./lease-actor.mjs', import.meta.url);
function actor() {
  const child = fork(fixture, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  child.stderrText = '';
  child.stderr.on('data', data => { child.stderrText += data; });
  return child;
}
async function request(child, message) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('fixture response deadline')), 2000);
    const response = value => finish(undefined, value);
    const exit = () => finish(new Error(`fixture exited before response: ${child.stderrText}`));
    function finish(error, value) { clearTimeout(timer); child.off('message', response); child.off('exit', exit); error ? reject(error) : resolve(value); }
    child.once('message', response); child.once('exit', exit);
    child.send(message);
  });
}
async function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
}
async function lab(run) {
  const root = await mkdtemp(join(tmpdir(), 'pi-sqlite-lease-'));
  const children = [];
  const spawn = () => { const child = actor(); children.push(child); return child; };
  const file = join(root, 'session.jsonl');
  await writeFile(file, '{}\n');
  try { await run({ root, file, spawn }); }
  finally { for (const child of children) await kill(child); await rm(root, { recursive: true, force: true }); }
}

test('a paused old callback cannot publish over or unlock a replacement; database inode survives release', async () => lab(async ({ file, spawn }) => {
  const first = spawn();
  const initial = await request(first, { type: 'open', file });
  assert.equal(initial.type, 'acquired');
  const before = await stat(initial.database);
  await request(first, { type: 'publish', incarnation: 'first' });
  assert.equal((await request(first, { type: 'pause-callback' })).type, 'paused');
  await request(first, { type: 'release' });
  const second = spawn();
  assert.equal((await request(second, { type: 'open', file })).type, 'acquired');
  await request(second, { type: 'publish', incarnation: 'second' });
  const contents = await readFile(initial.metadata, 'utf8');
  assert.equal((await request(first, { type: 'resume-callback' })).code, 'LEASE_CLOSED');
  await request(first, { type: 'release' });
  assert.equal(await readFile(initial.metadata, 'utf8'), contents);
  const contender = await request(spawn(), { type: 'open', file });
  assert.equal(contender.type, 'conflict');
  assert.equal(contender.reason, 'busy', 'replacement must still hold the kernel transaction, not merely retain metadata');
  assert.equal((await stat(initial.database)).ino, before.ino);
}));

test('supervisor SIGKILL with its old root still alive cannot authorize another writer', async () => lab(async ({ file, spawn }) => {
  const first = spawn();
  await request(first, { type: 'open', file });
  await request(first, { type: 'publish', incarnation: 'old-root-still-live' });
  await kill(first);
  process.kill(process.pid, 0);
  const next = await request(spawn(), { type: 'open', file });
  assert.equal(next.type, 'conflict');
  assert.equal(next.reason, 'recovery');
  assert.equal(next.owner.incarnation, 'old-root-still-live');
}));

test('verified dead root reopens automatically without replacing the lock inode', async () => lab(async ({ file, spawn }) => {
  const root = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const started = execFileSync('ps', ['-p', String(root.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
  const first = spawn(); const info = await request(first, { type: 'open', file });
  await request(first, { type: 'publish', incarnation: 'dead-root' });
  await kill(first);
  const record = JSON.parse(await readFile(info.metadata, 'utf8'));
  await writeFile(info.metadata, JSON.stringify({ ...record, pid: root.pid, started }));
  const inode = (await stat(info.database)).ino;
  await kill(root);
  const next = await request(spawn(), { type: 'open', file });
  assert.equal(next.type, 'acquired');
  assert.equal((await stat(info.database)).ino, inode);
}));

test('canonical aliases share one lock independent of agent directory', async () => lab(async ({ root, file, spawn }) => {
  const alias = join(root, 'alias.jsonl'); await symlink(file, alias);
  const first = spawn();
  await request(first, { type: 'open', file, root: join(root, 'agent-a') });
  await request(first, { type: 'publish', incarnation: 'owner' });
  const next = await request(spawn(), { type: 'open', file: alias, root: join(root, 'agent-b') });
  assert.equal(next.type, 'conflict'); assert.equal(next.reason, 'busy');
}));

test('busy primary and extended errors are distinct from I/O, corruption and missing capability', async () => {
  const { isSqliteBusy } = await import('../../agent/lifecycle/lease.mjs');
  assert.equal(isSqliteBusy({ errcode: 5 }), true);
  assert.equal(isSqliteBusy({ errcode: 261 }), true);
  for (const errcode of [6, 10, 26, undefined, '5']) assert.equal(isSqliteBusy({ errcode }), false);
});

test('invalid database is an infrastructure error, not a conflict', async () => lab(async ({ file, spawn }) => {
  const first = spawn(); const info = await request(first, { type: 'open', file });
  await request(first, { type: 'publish', incarnation: 'first' }); await request(first, { type: 'release' });
  // A different test process damages a released fixture database deliberately.
  await writeFile(info.database, 'synthetic non-database bytes');
  const next = await request(spawn(), { type: 'open', file });
  assert.equal(next.type, 'error'); assert.equal(next.sqlite, 26);
}));

for (const malformed of [undefined, 'null', '{broken JSON', '{"generation":"unknown","status":"active"}']) {
  test(`free lock with ${malformed ?? 'missing'} metadata reports initialization failure without altering evidence`, async () => lab(async ({ file, spawn }) => {
    const first = spawn(); const info = await request(first, { type: 'open', file });
    await request(first, { type: 'publish', incarnation: 'first' }); await request(first, { type: 'release' });
    const inode = (await stat(info.database)).ino;
    if (malformed === undefined) await rm(info.metadata); else await writeFile(info.metadata, malformed);
    const next = await request(spawn(), { type: 'open', file });
    assert.equal(next.type, 'error'); assert.equal(next.code, 'OWNER_METADATA_UNVERIFIABLE');
    assert.equal((await stat(info.database)).ino, inode);
    if (malformed === undefined) await assert.rejects(readFile(info.metadata), { code: 'ENOENT' });
    else assert.equal(await readFile(info.metadata, 'utf8'), malformed);
  }));
}

for (const malformed of [undefined, 'null', '{broken JSON']) {
  test(`busy lock with ${malformed ?? 'missing'} metadata remains a conflict`, async () => lab(async ({ file, spawn }) => {
    const first = spawn(); const info = await request(first, { type: 'open', file });
    await request(first, { type: 'publish', incarnation: 'live-owner' });
    if (malformed === undefined) await rm(info.metadata); else await writeFile(info.metadata, malformed);
    const next = await request(spawn(), { type: 'open', file });
    assert.equal(next.type, 'conflict'); assert.equal(next.reason, 'busy');
  }));
}

test('known database contention cannot become fail-open because metadata reads fail', async () => lab(async ({ file, spawn }) => {
  const first = spawn(); const info = await request(first, { type: 'open', file });
  await request(first, { type: 'publish', incarnation: 'live-owner' });
  await rm(info.metadata); await mkdir(info.metadata);
  const next = await request(spawn(), { type: 'open', file });
  assert.equal(next.type, 'conflict'); assert.equal(next.reason, 'busy');
}));

test('metadata I/O error is not silently classified as contention', async () => lab(async ({ file, spawn }) => {
  const first = spawn(); const info = await request(first, { type: 'open', file });
  await request(first, { type: 'publish', incarnation: 'first' }); await request(first, { type: 'release' });
  await rm(info.metadata); await mkdir(info.metadata);
  const next = await request(spawn(), { type: 'open', file });
  assert.equal(next.type, 'error'); assert.equal(next.code, 'EISDIR');
}));

for (const modification of ['PRAGMA application_id = 123', 'PRAGMA application_id = 0; CREATE TABLE foreign_contents(value)']) {
  test(`unexpected SQLite protocol state is preserved: ${modification}`, async () => lab(async ({ file, spawn }) => {
    const first = spawn(); const info = await request(first, { type: 'open', file });
    await request(first, { type: 'publish', incarnation: 'finished' }); await request(first, { type: 'release' });
    const fixture = new DatabaseSync(info.database);
    try { fixture.exec(modification); } finally { fixture.close(); }
    const metadata = await readFile(info.metadata, 'utf8');
    const next = await request(spawn(), { type: 'open', file });
    assert.equal(next.type, 'error'); assert.equal(next.code, 'LOCK_DATABASE_UNRECOGNIZED');
    assert.equal(await readFile(info.metadata, 'utf8'), metadata);
  }));
}

test('SIGKILL after provision permits a different process to win first initialization', async () => lab(async ({ root, file, spawn }) => {
  const directory = join(root, '.pi-lifecycle'); await mkdir(directory);
  const hash = createHash('sha256').update(await realpath(file)).digest('hex');
  const database = join(directory, `${hash}.sqlite`);
  const provisioner = spawn();
  assert.equal((await request(provisioner, { type: 'provision', database })).type, 'provisioned');
  const inode = (await stat(database)).ino;
  await kill(provisioner);
  const later = spawn();
  assert.equal((await request(later, { type: 'open', file })).type, 'acquired');
  assert.equal((await request(later, { type: 'publish', incarnation: 'later-opener' })).type, 'published');
  assert.equal((await request(later, { type: 'ack' })).type, 'ack');
  assert.equal((await request(spawn(), { type: 'open', file })).reason, 'busy');
  assert.equal((await stat(database)).ino, inode);
}));

test('preparing identity protects the commit/reacquisition gap and admission waits for active publication', async () => lab(async ({ file, spawn }) => {
  const first = spawn(); const info = await request(first, { type: 'open', file });
  assert.equal((await request(first, { type: 'ack' })).code, 'LEASE_NOT_READY');
  assert.equal((await request(first, { type: 'commit-initialization' })).code, 'LEASE_NOT_READY', 'preparing identity must precede durable marker commit');
  assert.equal((await request(first, { type: 'prepare', incarnation: 'initializer' })).type, 'prepared');
  const preparing = await readFile(info.metadata, 'utf8');
  assert.equal(JSON.parse(preparing).status, 'preparing');
  assert.equal((await request(first, { type: 'commit-initialization' })).type, 'committed');
  const observer = new DatabaseSync(info.database);
  try { assert.equal(observer.prepare('PRAGMA application_id').get().application_id, 0x50494c47); }
  finally { observer.close(); }
  const contender = await request(spawn(), { type: 'open', file });
  assert.equal(contender.type, 'conflict'); assert.equal(contender.reason, 'recovery');
  assert.equal(await readFile(info.metadata, 'utf8'), preparing);
  assert.equal((await request(first, { type: 'ack' })).code, 'LEASE_NOT_READY');
  assert.equal((await request(first, { type: 'reacquire' })).type, 'reacquired');
  assert.equal((await request(first, { type: 'ack' })).code, 'LEASE_NOT_READY');
  assert.equal((await request(first, { type: 'publish', incarnation: 'initializer' })).type, 'published');
  assert.equal((await request(first, { type: 'ack' })).type, 'ack');
  assert.equal((await request(spawn(), { type: 'open', file })).reason, 'busy');
}));

for (const changed of ['missing', 'corrupt', 'other-generation']) {
  test(`reacquisition refuses ${changed} evidence without overwriting it`, async () => lab(async ({ file, spawn }) => {
    const first = spawn(); const info = await request(first, { type: 'open', file });
    await request(first, { type: 'prepare', incarnation: 'initializer' });
    await request(first, { type: 'commit-initialization' });
    let evidence;
    if (changed === 'missing') await rm(info.metadata);
    else {
      evidence = changed === 'corrupt' ? 'null' : JSON.stringify({ ...JSON.parse(await readFile(info.metadata, 'utf8')), generation: 'different-valid-generation', status: 'active' });
      await writeFile(info.metadata, evidence);
    }
    const result = await request(first, { type: 'reacquire' });
    assert.equal(result.code, changed === 'other-generation' ? 'OWNER_INITIALIZATION_CHANGED' : 'OWNER_METADATA_UNVERIFIABLE');
    assert.equal((await request(first, { type: 'ack' })).code, 'LEASE_NOT_READY');
    await request(first, { type: 'release' });
    if (changed === 'missing') await assert.rejects(readFile(info.metadata), { code: 'ENOENT' });
    else assert.equal(await readFile(info.metadata, 'utf8'), evidence);
  }));
}

test('reacquisition has a deadline and cancellation during the gap preserves preparing evidence', async () => lab(async ({ file, spawn }) => {
  const first = spawn(); const info = await request(first, { type: 'open', file });
  assert.equal((await request(first, { type: 'prepare', incarnation: 'initializer' })).type, 'prepared');
  assert.equal((await request(first, { type: 'commit-initialization' })).type, 'committed');
  const preparing = await readFile(info.metadata, 'utf8');
  const blocker = spawn();
  assert.equal((await request(blocker, { type: 'hold-kernel', database: info.database })).type, 'holding');
  const start = Date.now();
  const result = await request(first, { type: 'reacquire' });
  assert.equal(result.sqlite & 255, 5); assert.ok(Date.now() - start < 1500);
  assert.equal((await request(first, { type: 'ack' })).code, 'LEASE_NOT_READY');
  assert.equal((await request(first, { type: 'release' })).type, 'released');
  assert.equal(await readFile(info.metadata, 'utf8'), preparing);
  await request(blocker, { type: 'release' });
  assert.equal((await request(spawn(), { type: 'open', file })).reason, 'recovery');
}));

for (const boundary of ['open', 'preparing', 'committed', 'reacquired', 'active', 'ack']) {
  test(`SIGKILL at ${boundary} cannot overwrite published identity or admit a replacement`, async () => lab(async ({ file, spawn }) => {
    const first = spawn(); const info = await request(first, { type: 'open', file });
    if (boundary !== 'open') assert.equal((await request(first, { type: 'prepare', incarnation: boundary })).type, 'prepared');
    if (['committed', 'reacquired', 'active', 'ack'].includes(boundary)) assert.equal((await request(first, { type: 'commit-initialization' })).type, 'committed');
    if (['reacquired', 'active', 'ack'].includes(boundary)) assert.equal((await request(first, { type: 'reacquire' })).type, 'reacquired');
    if (['active', 'ack'].includes(boundary)) assert.equal((await request(first, { type: 'publish', incarnation: boundary })).type, 'published');
    if (boundary === 'ack') assert.equal((await request(first, { type: 'ack' })).type, 'ack');
    const evidence = boundary === 'open' ? undefined : await readFile(info.metadata, 'utf8');
    await kill(first);
    const nextActor = spawn(); const next = await request(nextActor, { type: 'open', file });
    if (boundary === 'open') {
      assert.equal(next.type, 'acquired');
      assert.equal((await request(nextActor, { type: 'publish', incarnation: 'first-admitted-owner' })).type, 'published');
      assert.equal((await request(nextActor, { type: 'ack' })).type, 'ack');
    } else {
      assert.equal(next.type, 'conflict'); assert.equal(next.reason, 'recovery');
      assert.equal(await readFile(info.metadata, 'utf8'), evidence);
    }
  }));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const fixture = fileURLToPath(new URL('./shell-fixture.mjs', import.meta.url));
const evidence = mkdtempSync(join(tmpdir(), 'wakeups-shell-os-'));
console.log(`Private OS evidence: ${evidence}`);
function identity(pid) {
  try {
    const fields = execFileSync('ps', ['-o', 'pid=,ppid=,pgid=,stat=,lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
    if (fields.length < 9) return;
    return { pid: +fields[0], ppid: +fields[1], group: +fields[2], state: fields[3], started: fields.slice(4).join(' ') };
  } catch { return; }
}
function alive(id) {
  const now = identity(id.pid);
  return now && now.started === id.started && !now.state.startsWith('Z');
}
function signalPrivate(id, signal) {
  if (alive(id)) process.kill(id.pid, signal);
}
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) assert.fail('OS condition deadline'); await delay(20); }
}
async function actors(t) {
  const directory = mkdtempSync(join(evidence, 'case-'));
  const root = fork(fixture, ['root', directory], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
  const messages = [];
  let stderr = '';
  root.stderr.on('data', data => { stderr += data; });
  root.on('message', m => messages.push(m));
  const rootId = identity(root.pid);
  let helper, worker, grandchild;
  t.after(async () => {
    for (const id of [rootId, helper, worker, grandchild].filter(Boolean)) signalPrivate(id, 'SIGCONT');
    if (root.connected) root.send('shutdown');
    await delay(800);
    for (const id of [rootId, helper, worker, grandchild].filter(Boolean)) signalPrivate(id, 'SIGKILL');
    const owned = [rootId, helper, worker, grandchild].filter(Boolean);
    await until(() => owned.every(id => !alive(id)));
    writeFileSync(join(directory, 'cleanup.json'), JSON.stringify(owned.map(id => ({ ...id, alive: Boolean(alive(id)) })), null, 2));
    assert.equal(stderr, '');
  });
  await until(() => messages.some(m => m.type === 'receipt') && existsSync(join(directory, 'grandchild.json')));
  worker = identity(JSON.parse(readFileSync(join(directory, 'worker.json'))).pid);
  grandchild = identity(JSON.parse(readFileSync(join(directory, 'grandchild.json'))).pid);
  helper = identity(worker.ppid);
  assert.equal(helper.ppid, root.pid);
  assert.equal(helper.pid, helper.group, 'detached helper must lead its private group');
  assert.equal(worker.group, helper.pid);
  assert.equal(grandchild.group, helper.pid);
  assert.equal(grandchild.ppid, worker.pid);
  assert.notEqual(identity(process.pid).group, helper.group, 'never signal the test/user group');
  writeFileSync(join(directory, 'identities.json'), JSON.stringify({ root: rootId, helper, worker, grandchild }, null, 2));
  return { root, rootId, helper, worker, grandchild, messages, directory };
}
test('root SIGKILL cleans TERM-resistant foreground child and grandchild; unrelated sentinel survives', async t => {
  const a = await actors(t);
  const sentinelDir = mkdtempSync(join(evidence, 'sentinel-'));
  const sentinel = spawn(process.execPath, [fixture, 'sentinel', sentinelDir], { stdio: 'ignore' });
  const sentinelId = identity(sentinel.pid);
  t.after(async () => { signalPrivate(sentinelId, 'SIGKILL'); await until(() => !alive(sentinelId)); });
  await until(() => existsSync(join(sentinelDir, 'sentinel.json')));
  assert.notEqual(sentinelId.group, a.helper.group);
  signalPrivate(a.rootId, 'SIGKILL');
  await until(() => !alive(a.rootId));
  await until(() => [a.helper, a.worker, a.grandchild].every(id => !alive(id)), 3000);
  assert.ok(alive(sentinelId));
  writeFileSync(join(a.directory, 'root-death.json'), JSON.stringify({ sentinel: sentinelId,
    sentinelAlive: Boolean(alive(sentinelId)), groupMembers: [a.helper, a.worker, a.grandchild].map(id => ({ ...id, alive: Boolean(alive(id)) })) }, null, 2));
});
test('ownership loss cancels the live owned group without a stale exit notification', async t => {
  const a = await actors(t);
  a.root.send('lose-owner');
  await until(() => [a.helper, a.worker, a.grandchild].every(id => !alive(id)), 3000);
  assert.equal(a.messages.filter(m => m.type === 'event').length, 0);
});
test('helper SIGKILL reports unknown supervision, never claims shell exit or cleanup', async t => {
  const a = await actors(t);
  signalPrivate(a.helper, 'SIGKILL');
  await until(() => a.messages.some(m => m.type === 'warning'));
  assert.match(a.messages.find(m => m.type === 'warning').text, /supervision lost.*unknown/);
  assert.ok(alive(a.worker));
  assert.ok(alive(a.grandchild));
  assert.equal(a.messages.filter(m => m.type === 'event').length, 0);
});
test('hung helper yields bounded shutdown with unknown cleanup, then resumes private cleanup', async t => {
  const a = await actors(t);
  signalPrivate(a.helper, 'SIGSTOP');
  const start = Date.now();
  a.root.send('shutdown');
  await until(() => a.messages.some(m => m.type === 'shutdown'), 3500);
  assert.ok(Date.now() - start < 3500);
  assert.ok(a.messages.some(m => m.type === 'warning' && /unknown/.test(m.text)));
  assert.ok(alive(a.worker));
  assert.equal(a.messages.filter(m => m.type === 'event').length, 0);
  writeFileSync(join(a.directory, 'hung-shutdown.json'), JSON.stringify({ messages: a.messages,
    helperAlive: Boolean(alive(a.helper)), workerAlive: Boolean(alive(a.worker)) }, null, 2));
  signalPrivate(a.helper, 'SIGCONT');
  await until(() => [a.helper, a.worker, a.grandchild].every(id => !alive(id)), 3000);
});

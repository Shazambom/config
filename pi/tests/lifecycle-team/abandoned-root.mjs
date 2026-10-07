// Real exited owner leaves live=true plus its cancellation fence. Production
// registration must accept the admitted successor without reopening descendants.
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { EventEmitter, once } from 'node:events';
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [source, directory, role] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });
const jiti = createJiti(import.meta.url, { alias: { '@sinclair/typebox': import.meta.resolve('typebox').replace('file://', '') } });
const { TeamStore, processIdentity } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const teamDir = join(directory, 'team');
if (role === 'owner') {
  const store = TeamStore.create(teamDir);
  const token = await store.register({ id: 'root', name: 'root', parent: null, live: true, pid: process.pid, processIdentity: processIdentity(process.pid) });
  await store.register({ id: 'reserved', name: 'reserved', parent: 'root', live: true });
  await store.cancelTree('root', token);
  process.send({ root: store.state().members.root });
  process.on('message', () => process.exit(0));
  setTimeout(() => process.exit(90), 30000);
} else {
  const extension = (await jiti.import(join(source, 'pi-extension/subagents/team-extension.ts'))).default;
  process.env.PI_TEAM_DIR = teamDir;
  process.env.PI_TEAM_MEMBER = 'root';
  const owner = fork(fileURLToPath(import.meta.url), [source, directory, 'owner'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let active;
  function adapter(status = 'owned') {
    const handlers = new Map(), emitter = new EventEmitter();
    let tools = [], shutdowns = 0;
    emitter.on('session-lifecycle:admission', request => request.respond({ managed: true, status, sessionFile: join(directory, 'session.jsonl'), generation: 'admitted-successor' }));
    const ctx = { sessionManager: { getSessionId: () => 'abandoned', getEntries: () => [] }, isIdle: () => true, hasPendingMessages: () => false, shutdown() { shutdowns++; } };
    extension({ on: (n, fn) => handlers.set(n, fn), events: { emit: (n, v) => emitter.emit(n, v), on: (n, fn) => { emitter.on(n, fn); return () => emitter.off(n, fn); } }, registerTool() {}, registerCommand() {}, getActiveTools: () => tools, setActiveTools: t => { tools = t; }, appendEntry() {}, sendMessage() {} });
    return { start: () => handlers.get('session_start')({}, ctx), stop: () => handlers.get('session_shutdown')({}, ctx), get shutdowns() { return shutdowns; } };
  }
  try {
    const [{ root }] = await once(owner, 'message');
    const store = new TeamStore(teamDir);
    const before = store.state();
    assert.equal(before.members.root.live, true);
    assert(before.cancelled.includes('root'));
    assert.equal(processIdentity(root.pid), root.processIdentity, 'old owner really remains alive');
    const denied = adapter('conflict');
    await denied.start(); await denied.stop();
    assert.deepEqual(store.state(), before, 'denied admission cannot recover registration');
    const liveAttempt = adapter();
    await assert.rejects(liveAttempt.start(), /cancelled/i, 'live cancelled owner cannot be replaced');
    await liveAttempt.stop();
    assert.deepEqual(store.state(), before);
    const exited = once(owner, 'exit');
    owner.send('exit-without-retire');
    const [code, signal] = await exited;
    assert.equal(code, 0); assert.equal(signal, null);
    assert.equal(processIdentity(root.pid), undefined, 'old owner genuinely exited');
    assert.deepEqual(store.state(), before, 'exit did not retire the old root');
    writeFileSync(join(directory, 'old-owner.json'), JSON.stringify({ root, exitCode: code, signal, processAbsent: true, persisted: before }, null, 2));
    active = adapter();
    await active.start();
    assert.equal(active.shutdowns, 0, 'admitted successor must not shut down');
    const replacement = store.state();
    assert.equal(replacement.members.root.pid, process.pid);
    assert.equal(replacement.members.root.live, true);
    assert.notEqual(replacement.members.root.incarnation, root.incarnation);
    assert(!replacement.cancelled.includes('root'));
    assert(replacement.cancelled.includes('reserved'), 'descendant cancellation remains closed');
    await assert.rejects(store.register({ ...root, pid: process.pid, processIdentity: processIdentity(process.pid) }, root.incarnation), /incarnation/i, 'stale resume token cannot replace successor');
    await assert.rejects(store.register(before.members.reserved, before.members.reserved.incarnation), /cancelled/i);
    assert.deepEqual(await store.cancelTree('root', root.incarnation), []);
    assert.equal(await store.retire('root', root.incarnation), false);
    await liveAttempt.stop();
    assert.deepEqual(store.state(), replacement, 'old callbacks leave successor unchanged');
    writeFileSync(join(directory, 'replacement.json'), JSON.stringify(replacement, null, 2));
    console.log('PASS cancelled but unretired exited root recovery, managed admission, live-owner/stale-resume/descendant fences');
  } finally {
    await active?.stop();
    if (owner.exitCode === null && owner.signalCode === null) {
      const exited = once(owner, 'exit'); owner.kill('SIGKILL'); await exited;
    }
    writeFileSync(join(directory, 'cleanup.json'), JSON.stringify({ reaped: true, pid: owner.pid, exitCode: owner.exitCode, signal: owner.signalCode }));
  }
}

import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [source, directory] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });
const jiti = createJiti(import.meta.url, { alias: { '@sinclair/typebox': import.meta.resolve('typebox').replace('file://', '') } });
const { TeamStore, processIdentity, reserveTeamChild } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const extension = (await jiti.import(join(source, 'pi-extension/subagents/team-extension.ts'))).default;
const { cleanupTeam } = await jiti.import(join(source, 'pi-extension/subagents/team-arena.ts'));
const children = [], receipts = [];
try {
  for (const reason of ['reload', 'resume']) {
    process.env.PI_TEAM_DIR = join(directory, reason);
    process.env.PI_TEAM_MEMBER = 'worker';
    const store = TeamStore.create(process.env.PI_TEAM_DIR);
    await store.register({ id: 'root', name: 'root', parent: null, live: true });
    await store.register({ id: 'worker', name: 'worker', parent: 'root', live: true });
    const hooks = new Map(), bus = new EventEmitter();
    let active = [], shutdowns = 0;
    const ctx = { sessionManager: { getSessionId: () => reason, getEntries: () => [] }, isIdle: () => true, hasPendingMessages: () => false, shutdown: () => { shutdowns++; } };
    extension({ on: (n, fn) => hooks.set(n, fn), events: { emit: (n, v) => bus.emit(n, v), on: (n, fn) => { bus.on(n, fn); return () => bus.off(n, fn); } }, registerTool() {}, registerCommand() {}, getActiveTools: () => active, setActiveTools: value => { active = value; } });
    await hooks.get('session_start')({ reason: 'startup' }, ctx);
    const old = store.state().members.worker;
    const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'inherit'] });
    children.push(child);
    await once(child.stdout, 'data');
    await store.register({ id: 'nested', name: 'nested', parent: 'worker', live: true, pid: child.pid, processIdentity: processIdentity(child.pid) });
    // Pause after the real cancellation transaction, before process cleanup.
    // An already-prepared launch must not enter the reopened requesting member
    // during this await boundary.
    const cancelTree = store.cancelTree.bind(store);
    let cancelled, release;
    const boundary = new Promise(r => { cancelled = r; });
    const barrier = new Promise(r => { release = r; });
    store.cancelTree = async (...args) => { const result = await cancelTree(...args); cancelled(); await barrier; return result; };
    const stopping = cleanupTeam(store, 'worker', () => {}, old.incarnation, true);
    try {
      await boundary;
      await assert.rejects(reserveTeamChild(ctx, 'during-cleanup', join(directory, `${reason}-during.jsonl`), '', old.incarnation), /inactive|cancelled/i, 'no late launch while requester is retiring');
    } finally { release(); store.cancelTree = cancelTree; await stopping; }
    await hooks.get('session_shutdown')({ reason }, ctx);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(processIdentity(child.pid), undefined, 'reload/resume still stops owned descendants');
    assert.equal(processIdentity(process.pid), old.processIdentity, 'requesting runtime survives');
    await hooks.get('session_start')({ reason }, ctx);
    assert.equal(shutdowns, 0, `${reason} must not shut down requesting worker`);
    const fresh = store.state().members.worker;
    assert.equal(fresh.live, true);
    assert.notEqual(fresh.incarnation, old.incarnation);
    assert(store.state().cancelled.includes('nested'), 'delayed descendant remains fenced');
    await assert.rejects(store.register({ id: 'nested', name: 'nested', parent: 'worker', live: true }), /cancelled/);
    await assert.rejects(reserveTeamChild(ctx, 'late', join(directory, `${reason}-late.jsonl`), '', old.incarnation), /incarnation/);
    assert.deepEqual(await store.cancelTree('worker', old.incarnation), []);
    assert.equal(await store.retire('worker', old.incarnation), false);
    await store.cancelTree('root');
    await assert.rejects(store.register({ ...fresh, live: true }, fresh.incarnation), /cancelled/, 'reload never clears cancelled ancestor');
    await hooks.get('session_shutdown')({ reason: 'quit' }, ctx);
    receipts.push({ reason, child: child.pid, descendantExited: true, requesterAlive: true, before: old.incarnation, after: fresh.incarnation });
  }
  console.log('PASS child reload/same-file resume preserve requester, stop descendants and fence stale/ancestor launches');
} finally {
  await Promise.all(children.map(async c => { if (c.exitCode !== null || c.signalCode !== null) return; const exited = once(c, 'exit'); c.kill('SIGKILL'); await exited; }));
  writeFileSync(join(directory, 'receipts.json'), JSON.stringify({ receipts, reaped: children.map(c => ({ pid: c.pid, exitCode: c.exitCode, signal: c.signalCode })) }, null, 2));
}

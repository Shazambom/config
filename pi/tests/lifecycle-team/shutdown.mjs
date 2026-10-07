// Dispatch real team-extension hooks against private state and owned OS workers.
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
const [source, directory] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });
const jiti = createJiti(import.meta.url, { alias: { '@sinclair/typebox': import.meta.resolve('typebox').replace('file://', '') } });
const { TeamStore, processIdentity, reserveTeamChild, captureTeamParent } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const extension = (await jiti.import(join(source, 'pi-extension/subagents/team-extension.ts'))).default;
process.env.PI_TEAM_DIR = join(directory, 'team');
process.env.PI_TEAM_MEMBER = 'root';
const children = [];
const receipts = [];
async function worker(name) {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  await once(child.stdout, 'data');
  return { id: name, name, parent: 'root', live: true, pid: child.pid, processIdentity: processIdentity(child.pid) };
}
function adapter() {
  const handlers = new Map();
  const emitter = new EventEmitter();
  let tools = [];
  const pi = { on: (name, fn) => handlers.set(name, fn), events: { emit: (n, v) => emitter.emit(n, v), on: (n, fn) => { emitter.on(n, fn); return () => emitter.off(n, fn); } }, registerTool() {}, registerCommand() {}, getActiveTools: () => tools, setActiveTools: t => { tools = t; }, appendEntry() {}, sendMessage() {} };
  const ctx = { sessionManager: { getSessionId: () => 'shutdown', getEntries: () => [] }, isIdle: () => true, hasPendingMessages: () => false, shutdown() {} };
  extension(pi);
  return { ctx, start: () => handlers.get('session_start')({}, ctx), stop: () => handlers.get('session_shutdown')({}, ctx) };
}
try {
  const old = adapter();
  await old.start();
  const pendingParent = captureTeamParent(old.ctx);
  const store = new TeamStore(process.env.PI_TEAM_DIR);
  const sentinel = await worker('independent-service');
  const ordinary = await worker('ordinary');
  const resumed = await worker('resumed');
  const nested = { ...await worker('nested'), parent: ordinary.id };
  for (const m of [ordinary, resumed, nested]) await store.register(m);
  await old.stop();
  // Let Node reap terminated direct children before inspecting the PID table.
  await new Promise(resolve => setTimeout(resolve, 20));
  for (const m of [ordinary, resumed, nested]) {
    const actual = processIdentity(m.pid);
    receipts.push({ name: m.id, pid: m.pid, before: m.processIdentity, after: actual ?? null });
    assert.equal(actual, undefined, `shutdown must await ${m.id} process death`);
  }
  assert.equal(processIdentity(sentinel.pid), sentinel.processIdentity, 'independent service survives');
  await assert.rejects(reserveTeamChild(old.ctx, 'late', join(directory, 'late.jsonl'), ''), /cancelled|incarnation|inactive/i);
  const replacement = adapter();
  await replacement.start();
  await assert.rejects(store.register(ordinary), /cancelled/i, 'a previously reserved worker cannot start after its root resumes');
  const fresh = await worker('fresh');
  await store.register(fresh);
  await old.stop();
  assert.equal(processIdentity(fresh.pid), fresh.processIdentity, 'stale callback preserves replacement subtree');
  await assert.rejects(reserveTeamChild(old.ctx, 'stale-launch', join(directory, 'stale.jsonl'), '', pendingParent), /incarnation|inactive/i);
  assert.equal(processIdentity(sentinel.pid), sentinel.processIdentity);
  const reservation = await reserveTeamChild(replacement.ctx, 'new-launch', join(directory, 'new.jsonl'), '');
  assert.equal(store.state().members[reservation.id].live, true, 'replacement may launch normally');
  await replacement.stop();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(processIdentity(fresh.pid), undefined, 'replacement owns its new worker');
  console.log('PASS ordinary/resumed/nested shutdown, resume, stale shutdown and late launch fencing');
} finally {
  writeFileSync(join(directory, 'owned-process-receipts.json'), JSON.stringify(receipts, null, 2));
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }));
  writeFileSync(join(directory, 'cleanup.json'), JSON.stringify({ reaped: children.map(c => ({ pid: c.pid, exitCode: c.exitCode, signal: c.signalCode })) }));
}

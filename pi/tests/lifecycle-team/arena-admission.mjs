import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [source, directory] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });
const jiti = createJiti(import.meta.url);
const { TeamStore } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const { installArena } = await jiti.import(join(source, 'pi-extension/subagents/team-arena.ts'));
const { workerLaunches } = await jiti.import(join(source, 'pi-extension/subagents/worker-lifecycle.ts'));
process.env.PI_CODING_AGENT_DIR = join(directory, 'agent');
delete process.env.PI_LIFECYCLE_OWNER;
mkdirSync(join(process.env.PI_CODING_AGENT_DIR, 'lifecycle'), { recursive: true });
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'lifecycle/session-lifecycle.ts'), '// path fixture only\n');
const owned = { managed: true, status: 'owned', sessionFile: join(directory, 'root.jsonl'), generation: 'one' };
for (const status of ['pending', 'unprotected', 'revoked-at-lock']) {
  process.env.PI_TEAM_DIR = join(directory, status); process.env.PI_TEAM_MEMBER = 'root';
  const store = TeamStore.create(process.env.PI_TEAM_DIR);
  await store.register({ id: 'root', name: 'root', parent: null, live: true });
  await store.register({ id: 'peer', name: 'peer', parent: 'root', live: true });
  await store.setDesired(true);
  const pending = await store.send('peer', { to: 'root', message: 'must survive rejected arena' });
  const before = store.state();
  const bus = new EventEmitter(), commands = new Map();
  let receipt = status === 'revoked-at-lock' ? owned : { managed: true, status };
  bus.on('session-lifecycle:admission', req => req.respond(receipt));
  const pi = { events: { emit: (n, v) => bus.emit(n, v) }, on() {}, registerCommand: (n, c) => commands.set(n, c), getCommands: () => [{ source: 'skill', name: 'arena', sourceInfo: { path: join(directory, 'SKILL.md') } }], appendEntry() {}, sendMessage() {} };
  const capture = workerLaunches(pi, process.env.PI_CODING_AGENT_DIR);
  let launchCalls = 0;
  installArena(pi, { async launch() { launchCalls++; capture(); throw new Error('Launch must not be reached'); }, async watch() { throw new Error('No worker'); }, close() {} });
  const ctx = { sessionManager: { getSessionId: () => status }, mode: 'print', ui: { notify() {} } };
  if (status === 'revoked-at-lock') mkdirSync(join(store.dir, 'lock'));
  const running = commands.get('arena').handler('synthetic', ctx);
  if (status === 'revoked-at-lock') { receipt = { managed: true, status: 'unprotected' }; rmSync(join(store.dir, 'lock'), { recursive: true }); }
  try { await running; } catch (error) { assert.match(error.message, /admission/i); }
  assert.deepEqual(store.state(), before, `${status}: rejected arena cannot increment generation or alter leases`);
  assert.equal(launchCalls, 0, `${status}: admission must precede launch/shared mutation`);
  assert.deepEqual(store.pending('root', new Set()).map(m => m.id), [pending.id], 'queued team message remains deliverable');
}
let admitted = true;
const guarded = TeamStore.create(join(directory, 'owned-lease'), () => admitted);
await guarded.transaction(s => { s.leases.push('foreign-lease'); });
await assert.rejects(guarded.withSuspension(async () => { admitted = false; throw new Error('work failed'); }), /work failed/, 'revocation must not prevent releasing its own suspension');
assert.deepEqual(guarded.state().leases, ['foreign-lease']);
await assert.rejects(guarded.update('root', { live: false }), /admission/);
await assert.rejects(guarded.setDesired(true), /admission/);
console.log('PASS arena admission precedes shared state/lock acquisition; pending delivery and own-token-only release survive revocation');

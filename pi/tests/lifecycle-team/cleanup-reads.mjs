// Observe filesystem snapshots without replacing cancellation/retirement logic.
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [source, directory] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });
const jiti = createJiti(import.meta.url);
const { TeamStore } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const { cleanupTeam } = await jiti.import(join(source, 'pi-extension/subagents/team-arena.ts'));
const store = TeamStore.create(join(directory, 'team'));
const root = await store.register({ id: 'root', name: 'root', parent: null, live: true });
await store.register({ id: 'child', name: 'child', parent: 'root', live: true });
const readState = store.state.bind(store);
let reads = 0, rootChecks = 0, childChecks = 0;
store.state = () => {
  reads++;
  const snapshot = readState();
  snapshot.members = new Proxy(snapshot.members, {
    get(target, key) {
      if (key === 'root') rootChecks++;
      if (key === 'child') childChecks++;
      return target[key];
    },
  });
  return snapshot;
};
await cleanupTeam(store, 'root', () => { throw new Error('No pane belongs to this fixture'); }, root);
writeFileSync(join(directory, 'reads.json'), JSON.stringify({ reads, rootChecks, childChecks }, null, 2));
assert(rootChecks > 1, 'cleanup checks ownership again at each action/poll boundary');
assert.equal(childChecks, rootChecks, 'each scoped check tests parent and child incarnation');
assert.equal(reads, rootChecks, 'each ownership check must use exactly one fresh state snapshot');
assert.equal(readState().members.child.live, false, 'actual conditional retirement still completes');
const before = readState();
await cleanupTeam(store, 'root', () => { throw new Error('Stale cleanup must not close anything'); }, 'stale-incarnation');
assert.deepEqual(readState(), before, 'stale cancellation leaves persisted state unchanged');
console.log(`PASS cleanup uses one fresh snapshot per ownership check: ${reads} reads for ${rootChecks} checks; stale cancellation preserved`);

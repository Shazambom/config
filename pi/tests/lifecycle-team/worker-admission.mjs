import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const [source, directory] = process.argv.slice(2);
const { workerLaunches } = await createJiti(import.meta.url).import(join(source, 'pi-extension/subagents/worker-lifecycle.ts'));
mkdirSync(join(directory, 'lifecycle'), { recursive: true });
writeFileSync(join(directory, 'lifecycle/session-lifecycle.ts'), '// Existence fixture; this test does not load the guard.\n');
const owned = { managed: true, status: 'owned', sessionFile: join(directory, 'session.jsonl'), generation: 'first' };
let reply;
const pi = { events: { emit(_name, request) { if (reply) request.respond(reply); } } };
const saved = process.env.PI_LIFECYCLE_OWNER;
delete process.env.PI_LIFECYCLE_OWNER;
try {
  const capture = workerLaunches(pi, directory);
  const legacy = capture();
  assert.equal(legacy.owner, undefined);
  assert.equal(legacy.extension, undefined);
  legacy.assertCurrent();
  for (const status of ['pending', 'conflict', 'stopping', 'unprotected']) {
    reply = { managed: true, status };
    assert.throws(capture, /admission/i);
  }
  reply = owned;
  assert.throws(legacy.assertCurrent, /changed/i, 'legacy launch cannot cross a newly managed boundary');
  const root = capture();
  const owner = JSON.parse(root.owner);
  assert.deepEqual(owner, { pid: process.pid, started: execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim(), sessionFile: owned.sessionFile, generation: owned.generation });
  root.assertCurrent();
  reply = { ...owned, generation: 'replacement' };
  assert.throws(root.assertCurrent, /changed/i);
  reply = undefined;
  assert.throws(capture, /admission/i, 'missing responder cannot reopen observed managed launches');
  process.env.PI_LIFECYCLE_OWNER = ` ${root.owner} `;
  reply = { ...owned, sessionFile: join(directory, 'child.jsonl'), generation: 'child-lock' };
  const nested = workerLaunches(pi, directory)();
  assert.equal(nested.owner, process.env.PI_LIFECYCLE_OWNER, 'nested launch preserves exact original bytes');
  assert.equal(JSON.parse(nested.owner).generation, 'first', 'child lock cannot become owning root');
  nested.assertCurrent();
  reply = { ...owned, status: 'stopping' };
  assert.throws(nested.assertCurrent, /admission/i);
  console.log('PASS worker launch admission, stale/missing receipts, explicit legacy and fixed-original-root inheritance');
} finally {
  if (saved === undefined) delete process.env.PI_LIFECYCLE_OWNER;
  else process.env.PI_LIFECYCLE_OWNER = saved;
}

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { join } from 'node:path';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createJiti } from 'jiti';
// Install before Jiti resolves the builtin import; still execute the real ps.
const identityCalls = [];
const originalExecFileSync = childProcess.execFileSync;
mock.method(childProcess, 'execFileSync', (...args) => {
  identityCalls.push(args);
  return originalExecFileSync(...args);
});
syncBuiltinESMExports();
const jiti = createJiti(import.meta.url);
const root = process.env.OM_STOP_SOURCE;
const { Runtime } = await jiti.import(join(root, 'src/runtime.ts'));
const { buildWorkerArgv, buildWorkerEnv } = await jiti.import(join(root, 'src/spawn/launch.ts'));
const owned = { managed: true, status: 'owned', sessionFile: join(process.env.OM_STOP_ARTIFACTS, 'owner.jsonl'), generation: 'test-generation' };
const host = (...replies) => ({ events: { emit(event, request) {
  assert.equal(event, 'session-lifecycle:admission');
  for (const reply of replies) request.respond(reply);
} } });

test('legacy is allowed only before management is observed', () => {
  const runtime = new Runtime();
  assert.equal(runtime.workerOwner(host()), undefined);
  assert.throws(() => runtime.workerOwner(host({ managed: true, status: 'pending' })));
  assert.throws(() => runtime.workerOwner(host()));
  assert.deepEqual(JSON.parse(runtime.workerOwner(host(owned))), {
    pid: process.pid, started: execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim(),
    sessionFile: owned.sessionFile, generation: owned.generation,
  });
});

for (const replies of [
  [undefined], [{ managed: false, status: 'owned' }], [owned, owned],
  [{ ...owned, generation: '' }], [{ ...owned, sessionFile: '' }],
  ...['pending', 'conflict', 'stopping', 'unprotected'].map(status => [{ managed: true, status }]),
]) test(`reject invalid admission ${JSON.stringify(replies)}`, () => {
  assert.throws(() => new Runtime().workerOwner(host(...replies)), /admission/);
});

test('query exceptions do not authorize a legacy launch', () => {
  assert.throws(() => new Runtime().workerOwner({ events: { emit() { throw new Error('broken bus'); } } }), /broken bus|admission/);
});

test('inherited original owner is forwarded verbatim, not replaced', () => {
  const previous = process.env.PI_LIFECYCLE_OWNER;
  const inherited = JSON.stringify({ pid: 123, started: 'original start', sessionFile: owned.sessionFile, generation: owned.generation }, null, 2);
  process.env.PI_LIFECYCLE_OWNER = inherited;
  try {
    const runtime = new Runtime();
    assert.throws(() => runtime.workerOwner(host()));
    assert.equal(runtime.workerOwner(host(owned)), inherited);
  } finally {
    if (previous === undefined) delete process.env.PI_LIFECYCLE_OWNER; else process.env.PI_LIFECYCLE_OWNER = previous;
  }
});

test('self identity is captured once while every admission receipt is queried afresh', async () => {
  const calls = identityCalls;
  calls.length = 0;
  const previousOwner = process.env.PI_LIFECYCLE_OWNER;
  delete process.env.PI_LIFECYCLE_OWNER;
  try {
    const runtime = new Runtime();
    let receipt = owned;
    let queries = 0;
    const pi = { events: { emit(_event, { respond }) { queries++; respond(receipt); } } };
    const before = runtime.workerOwner(pi);
    assert.equal(runtime.workerOwner(pi), before);
    assert.equal(runtime.workerOwner(pi), before);
    assert.equal(queries, 3, 'all three dispatch admission checks remain');
    assert.equal(calls.length, 1, 'one ps invocation for this immutable process identity');
    assert.deepEqual(calls[0].slice(0, 2), ['ps', ['-p', String(process.pid), '-o', 'lstart=']]);

    // Asynchronous preparation must not turn an earlier owned receipt into authority.
    await Promise.resolve();
    receipt = { ...owned, generation: 'replacement-generation' };
    const changedGeneration = JSON.parse(runtime.workerOwner(pi));
    assert.equal(changedGeneration.generation, receipt.generation);
    assert.notEqual(JSON.stringify(changedGeneration), before);
    receipt = { ...receipt, sessionFile: join(process.env.OM_STOP_ARTIFACTS, 'replacement.jsonl') };
    assert.equal(JSON.parse(runtime.workerOwner(pi)).sessionFile, receipt.sessionFile);
    receipt = { managed: true, status: 'pending' };
    assert.throws(() => runtime.workerOwner(pi), /admission/);
    assert.equal(queries, 6, 'generation, file and pending state are not cached');
    assert.equal(calls.length, 1);

    const inherited = JSON.stringify({ ...JSON.parse(before), pid: 123, started: 'original root' }, null, 2);
    process.env.PI_LIFECYCLE_OWNER = inherited;
    receipt = owned;
    assert.equal(runtime.workerOwner(pi), inherited, 'cached self identity never replaces inherited bytes');
    assert.equal(calls.length, 1);
    assert.equal(queries, 7);
  } finally {
    if (previousOwner === undefined) delete process.env.PI_LIFECYCLE_OWNER; else process.env.PI_LIFECYCLE_OWNER = previousOwner;
  }
});

test('managed argv loads private lifecycle before the OM worker extension; legacy does not', () => {
  const owner = JSON.stringify({ pid: process.pid, started: 'test', sessionFile: owned.sessionFile, generation: owned.generation });
  const options = { model: { provider: 'private', id: 'test' }, sessionName: 'test', kickoffPrompt: 'test', owner };
  const argv = buildWorkerArgv(options);
  const first = argv.indexOf('-e');
  assert.equal(argv[first + 1], join(process.env.PI_CODING_AGENT_DIR, 'lifecycle', 'session-lifecycle.ts'));
  assert.equal(argv[first + 2], '-e');
  assert.match(argv[first + 3], /agent\/index\.ts$/);
  const env = buildWorkerEnv('observer', { memoryRoot: root, runId: 'test', owner });
  assert.equal(env.PI_LIFECYCLE_OWNER, owner);
  const legacy = buildWorkerArgv({ ...options, owner: undefined });
  assert.match(legacy[legacy.indexOf('-e') + 1], /agent\/index\.ts$/);
});

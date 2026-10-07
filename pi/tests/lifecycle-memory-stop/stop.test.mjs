import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEventListeners } from 'node:events';
import { existsSync, mkdirSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createJiti } from 'jiti';

const root = process.env.OM_STOP_SOURCE;
const artifacts = process.env.OM_STOP_ARTIFACTS;
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const jiti = createJiti(import.meta.url);
const { spawnWorker } = await jiti.import(join(root, 'src/spawn/launch.ts'));
const { default: extension } = await jiti.import(join(root, 'src/index.ts'));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
const pids = dir => existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.ready')).map(n => Number(n.split('.')[0])) : [];
async function until(check, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!check()) { assert.ok(Date.now() < end, 'timed out waiting for worker evidence'); await delay(20); }
}
function receipt(label, ids, exit) {
  for (const pid of ids) assert.equal(alive(pid), false, `worker ${pid} still alive`);
  const row = { label, pids: ids, alive: ids.map(alive), exit };
  appendFileSync(join(artifacts, 'process-close.jsonl'), JSON.stringify(row) + '\n');
  console.log('process-close', JSON.stringify(row));
}
async function cleanup(dir, task) {
  for (const pid of pids(dir)) if (alive(pid)) process.kill(pid, 'SIGKILL');
  if (task) await task;
}

for (const mode of ['complete', 'cancel-clean', 'resist']) {
  test(`actual launch: ${mode}`, async () => {
    const dir = join(artifacts, `launch-${mode}`); mkdirSync(dir, { recursive: true });
    const controller = new AbortController();
    const task = spawnWorker({ argv: [process.execPath, worker], cwd: dir, env: { ...process.env, OM_TEST_MODE: mode }, signal: controller.signal });
    let exit;
    task.then(value => { exit = value; });
    try {
      await until(() => pids(dir).length === 1);
      if (mode !== 'complete') controller.abort();
      await until(() => exit !== undefined, 4500);
      assert.equal(exit.code, mode === 'resist' ? null : 0);
      assert.equal(exit.signal, mode === 'resist' ? 'SIGKILL' : null);
      if (mode !== 'complete') assert.ok(existsSync(join(dir, `${pids(dir)[0]}.term`)), 'worker received TERM before close');
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      receipt(mode, pids(dir), exit);
    } finally { await cleanup(dir, task); }
  });
}

test('already aborted launch rejects without starting a process or creating cwd', async () => {
  const dir = join(artifacts, 'pre-aborted');
  const signal = AbortSignal.abort();
  await assert.rejects(spawnWorker({ argv: [process.execPath, worker], cwd: dir, env: process.env, signal }), { name: 'AbortError' });
  assert.equal(existsSync(dir), false);
});

test('spawn error settles and removes abort listener', async () => {
  const controller = new AbortController();
  const exit = await spawnWorker({ argv: [join(artifacts, 'missing-command')], cwd: artifacts, env: process.env, signal: controller.signal });
  assert.notEqual(exit.code, 0);
  assert.equal(exit.stderr, 'spawn error');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

for (const mode of ['complete', 'cancel-clean', 'resist']) {
    test(`actual extension shutdown and dispatch: ${mode}`, async () => {
      // Only the Pi host adapter is mocked. Runtime, config, triggers, launcher,
      // ledger and filesystem code come from the checksum-verified patched source.
      const dir = join(artifacts, `extension-${mode}`); mkdirSync(dir, { recursive: true });
      const handlers = new Map();
      const commits = [];
      const branch = [
        { type: 'message', id: 'old', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'old message' } },
        { type: 'custom', id: 'obs', customType: 'om.observations.recorded', data: { coversUpToId: 'old', observations: [{ timestamp: '2026-01-01T00:00:00', content: 'existing observation', tokenCount: 100 }, { timestamp: '2026-01-01T00:00:01', content: 'retained observation', tokenCount: 100 }] } },
        { type: 'message', id: 'new', timestamp: '2026-01-02T00:00:00Z', message: { role: 'user', content: 'new message '.repeat(100) } },
      ];
      const pi = {
        events: { emit() {} },
        on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
        registerCommand() {},
        appendEntry: (customType, data) => { commits.push(customType); branch.push({ type: 'custom', id: `commit-${commits.length}`, customType, data }); },
      };
      const ctx = { cwd: dir, hasUI: false, sessionManager: { getSessionId: () => 'test', getBranch: () => branch, getEntries: () => branch } };
      const memoryRoot = join(dir, '.memory', 'test');
      mkdirSync(join(dir, '.pi'), { recursive: true });
      writeFileSync(join(dir, '.pi', 'settings.json'), JSON.stringify({ 'observational-memory': {
        enabled: true, passive: false, chunkTokens: 10, observerConcurrency: 1, consolidateAtPoolTokens: 2, poolTargetTokens: 1,
      } }));
      const oldArgv = process.argv[1];
      const oldMode = process.env.OM_TEST_MODE;
      const emit = async event => { for (const handler of handlers.get(event) ?? []) await handler({}, ctx); };
      let shutdown;
      try {
        extension(pi);
        await emit('session_start');
        process.argv[1] = worker;
        process.env.OM_TEST_MODE = mode;
        await emit('turn_end');
        await until(() => pids(memoryRoot).length === 2);
        if (mode === 'complete') {
          await until(() => commits.includes('om.observations.recorded') && commits.includes('om.observations.dropped'));
          assert.ok(commits.includes('om.observations.recorded'), 'normal observer commits');
          assert.ok(commits.includes('om.observations.dropped'), 'normal consolidator commits');
        }
        const before = [...commits];
        let settled = false;
        shutdown = emit('session_shutdown').then(() => { settled = true; });
        await delay(30);
        if (mode !== 'complete') assert.equal(settled, false, 'shutdown must await worker close');
        // Events delivered after cancellation must not start more work.
        await emit('turn_end');
        await until(() => settled, 4500);
        assert.equal(pids(memoryRoot).length, 2);
        assert.deepEqual(commits, before, 'no post-cancellation ledger/cost commits');
        receipt(`extension-${mode}`, pids(memoryRoot));
      } finally {
        process.argv[1] = oldArgv;
        if (oldMode === undefined) delete process.env.OM_TEST_MODE; else process.env.OM_TEST_MODE = oldMode;
        shutdown ??= emit('session_shutdown');
        await cleanup(memoryRoot);
        await shutdown;
        await until(() => pids(memoryRoot).every(pid => !alive(pid)));
      }
    });
}

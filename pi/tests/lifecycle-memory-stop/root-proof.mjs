import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
const lab = process.argv[2];
const rows = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const probes = () => rows(join(lab, 'om-worker-probe.jsonl'));
const exists = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function until(check, timeout = 10000) {
  const deadline = performance.now() + timeout;
  while (!check()) { assert.ok(performance.now() < deadline, 'private runtime observation deadline'); await delay(20); }
}
const record = row => {
  console.log(JSON.stringify(row));
  appendFileSync(join(lab, 'om-process-close.jsonl'), JSON.stringify(row) + '\n');
};
const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
const sentinelExit = once(sentinel, 'exit');
let workerPid, latePid, lateTask;
const lateController = new AbortController();
try {
  await until(() => probes().some(row => row.event === 'before-agent'));
  const start = probes().find(row => row.event === 'start');
  workerPid = start.pid;
  assert.equal(start.sessionFile, null, 'actual CLI worker is stateless');
  assert.equal(start.receipts.length, 1);
  assert.equal(start.receipts[0].status, 'owned');
  const dispatched = rows(join(lab, 'om-worker-root.jsonl')).find(row => row.event === 'spawn');
  assert.equal(start.receipts[0].sessionFile, dispatched.owner.sessionFile);
  assert.equal(start.receipts[0].generation, dispatched.owner.generation);
  const rootPid = JSON.parse(readFileSync(join(lab, 'actors', 'pi-root.json'), 'utf8')).pid;
  assert.equal(dispatched.root, rootPid);
  assert.equal(dispatched.owner.pid, rootPid);
  assert.equal(execFileSync('ps', ['-p', String(rootPid), '-o', 'lstart='], { encoding: 'utf8' }).trim(), dispatched.owner.started);
  assert.equal(exists(workerPid), true);
  // Wait for a genuine provider request, not merely a startup marker.
  await until(() => rows(join(lab, 'events.jsonl')).some(row => row.event === 'stream-started'));
  const killedAt = performance.now();
  process.kill(rootPid, 'SIGKILL');
  await until(() => !exists(rootPid), 5000);
  const rootAbsentAt = performance.now();
  await until(() => !exists(workerPid), Math.max(1, 5000 - (performance.now() - killedAt)));
  const workerAbsentAt = performance.now();
  assert.ok(workerAbsentAt - killedAt <= 5000, 'worker absent within five seconds of root SIGKILL');
  assert.ok(probes().some(row => row.pid === workerPid && row.event === 'term'), 'hung worker received and resisted TERM');
  assert.equal(exists(sentinel.pid), true);
  record({ case: 'root-SIGKILL', rootPid, workerPid, sentinelPid: sentinel.pid, rootAlive: exists(rootPid), workerAlive: exists(workerPid), sentinelAlive: exists(sentinel.pid), killToWorkerAbsentMs: workerAbsentAt - killedAt, rootAbsentToWorkerAbsentMs: workerAbsentAt - rootAbsentAt });

  // Launch through the actual patched OM launcher with that now-dead original receipt.
  const agent = join(lab, 'agent');
  const previousAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  const jiti = createJiti(import.meta.url);
  const { buildWorkerArgv, buildWorkerEnv, spawnWorker } = await jiti.import(join(lab, 'om-source', 'src/spawn/launch.ts'));
  const originalArgv = process.argv[1];
  process.argv[1] = JSON.parse(readFileSync(join(lab, 'cli.json'), 'utf8')).cli;
  const owner = JSON.stringify(dispatched.owner);
  const argv = buildWorkerArgv({ model: { provider: 'lifecycle', id: 'offline' }, sessionName: 'private-late-worker', kickoffPrompt: 'slow must not reach provider', owner });
  process.argv[1] = originalArgv;
  argv.splice(argv.indexOf('-p'), 0, '--no-session', '-e', join(agent, 'probes', 'worker-probe.ts'));
  const built = buildWorkerEnv('observer', { memoryRoot: join(lab, 'late-memory'), runId: 'late', owner });
  if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
  // An explicit clean env, never host credentials. Reuse the lab's network fence.
  const env = {
    PATH: process.env.PATH, HOME: join(lab, 'home'), PI_CODING_AGENT_DIR: agent,
    PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', LIFECYCLE_LAB: lab,
    NODE_OPTIONS: `--import=${fileURLToPath(new URL('../lifecycle-lab/provider.mjs', import.meta.url))}`,
    OM_WORKER: built.OM_WORKER, OM_RUN_ID: built.OM_RUN_ID, OM_RESULT_PATH: built.OM_RESULT_PATH,
    OM_COST_PATH: built.OM_COST_PATH, OM_MEMORY_DIR: built.OM_MEMORY_DIR, PI_LIFECYCLE_OWNER: built.PI_LIFECYCLE_OWNER,
  };
  const requestsBefore = rows(join(lab, 'events.jsonl')).filter(row => row.event === 'request').length;
  lateTask = spawnWorker({ argv, cwd: built.OM_MEMORY_DIR, env, signal: lateController.signal });
  await until(() => probes().some(row => row.event === 'start' && row.pid !== workerPid));
  const late = probes().find(row => row.event === 'start' && row.pid !== workerPid);
  latePid = late.pid;
  assert.equal(late.receipts[0].status, 'stopping');
  let exit;
  lateTask.then(value => { exit = value; });
  await until(() => exit !== undefined, 5000);
  assert.equal(exists(latePid), false);
  assert.equal(rows(join(lab, 'events.jsonl')).filter(row => row.event === 'request').length, requestsBefore);
  assert.equal(exists(sentinel.pid), true);
  assert.equal(readdirSync(join(lab, 'histories', '.pi-lifecycle')).filter(name => name.endsWith('.sqlite')).length, 1, 'stateless workers create no session lease');
  record({ case: 'already-dead-owner', workerPid: latePid, workerAlive: exists(latePid), sentinelAlive: exists(sentinel.pid), exit });
} finally {
  lateController.abort();
  for (const pid of [workerPid, latePid]) if (pid && exists(pid)) process.kill(pid, 'SIGKILL');
  if (lateTask) await lateTask;
  sentinel.kill('SIGKILL');
  await sentinelExit;
}

// Private real-CLI probe. Loaded after the root lifecycle guard by the lab.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

export default function (pi: any) {
  const jiti = createJiti(import.meta.url);
  pi.on('session_start', async () => {
    const source = join(process.env.LIFECYCLE_LAB!, 'om-source');
    const { Runtime } = await jiti.import(join(source, 'src/runtime.ts'));
    const { buildWorkerArgv, buildWorkerEnv, spawnWorker } = await jiti.import(join(source, 'src/spawn/launch.ts'));
    const runtime = new Runtime();
    const owner = runtime.workerOwner(pi);
    if (owner === undefined) throw new Error('Private root must have managed admission');
    const argv = buildWorkerArgv({
      model: { provider: 'lifecycle', id: 'offline' },
      sessionName: 'private-om-root-stop',
      kickoffPrompt: 'slow private OM original-root loss test',
      owner,
    });
    // Exercise the stateless worker contract without changing OM's recorded-worker default.
    argv.splice(argv.indexOf('-p'), 0, '--no-session', '-e', join(dirname(fileURLToPath(import.meta.url)), 'worker-probe.ts'));
    const memoryRoot = join(process.env.LIFECYCLE_LAB!, 'worker-memory');
    const env = buildWorkerEnv('observer', { memoryRoot, runId: 'private-root-stop', owner });
    // Recheck immediately before actual dispatch after the asynchronous module imports.
    if (runtime.workerOwner(pi) !== owner) throw new Error('Private root admission changed');
    const task = spawnWorker({ argv, cwd: memoryRoot, env });
    appendFileSync(join(process.env.LIFECYCLE_LAB!, 'om-worker-root.jsonl'), JSON.stringify({ event: 'spawn', root: process.pid, owner: JSON.parse(owner), argv }) + '\n');
    void task.then(exit => appendFileSync(join(process.env.LIFECYCLE_LAB!, 'om-worker-root.jsonl'), JSON.stringify({ event: 'close', root: process.pid, exit }) + '\n'));
  });
}

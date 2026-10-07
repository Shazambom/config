// Private real-CLI fixture; no admission or owner monitoring is mocked here.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export default function (pi: any) {
  const record = (event: string, extra: object = {}) => appendFileSync(
    join(process.env.LIFECYCLE_LAB!, 'om-worker-probe.jsonl'),
    JSON.stringify({ event, pid: process.pid, time: Date.now(), ...extra }) + '\n',
  );
  // Deliberately resist TERM. The real lifecycle helper must stop this worker.
  process.on('SIGTERM', () => record('term'));
  pi.on('session_start', (_event: unknown, ctx: any) => {
    const receipts: unknown[] = [];
    pi.events.emit('session-lifecycle:admission', { respond: (value: unknown) => receipts.push(value) });
    record('start', { receipts, sessionFile: ctx.sessionManager.getSessionFile() ?? null });
    if ((receipts[0] as any)?.status === 'owned') setInterval(() => {}, 1000);
  });
  pi.on('before_agent_start', () => record('before-agent'));
  pi.on('session_shutdown', () => {
    record('shutdown');
    return new Promise(() => {});
  });
}

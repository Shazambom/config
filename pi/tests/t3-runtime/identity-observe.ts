import { appendFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export default function(pi: any) {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'identity-observations.jsonl');
  pi.on('context', (_event: any, ctx: any) => {
    const identities: any[] = [], owners: any[] = [];
    const file = ctx.sessionManager.getSessionFile();
    pi.events.emit('subagents:identity', { respond: (value: any) => identities.push(value) });
    pi.events.emit('session-lifecycle:admission', { respond: (value: any) => owners.push(value) });
    appendFileSync(path, JSON.stringify({ event: 'context', pid: process.pid, cli: process.argv[1], node: process.execPath,
      sessionId: ctx.sessionManager.getSessionId(), file, canonical: realpathSync(file), identities, owners }) + '\n');
  });
}

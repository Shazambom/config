import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default function(pi: any) {
  pi.registerTool({
    name: 'fixture_recovery_hold', label: 'Private recovery barrier', description: 'Record one private effect and hold for owned-process interruption.',
    executionMode: 'sequential', parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(id: string, _args: any, signal: AbortSignal, _update: any, ctx: any) {
      appendFileSync(join(ctx.cwd, 'recovery-counter.txt'), '1\n');
      writeFileSync(join(ctx.cwd, 'recovery-barrier.json'), JSON.stringify({ pid: process.pid, sessionFile: ctx.sessionManager.getSessionFile(), callId: id }));
      await new Promise((_resolve, reject) => {
        const abort = () => reject(new Error('owned fixture interrupted'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      return { content: [], details: {} };
    }
  });
}

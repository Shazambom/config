import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export default function(pi: any) {
  const { mode, schedule } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'wake-mode.json'), 'utf8'));
  if (!['sequential', 'parallel'].includes(mode)) throw new Error('Invalid fixture execution mode');
  let cronDeadline: number | undefined;
  const record = (ctx: any, event: any) => appendFileSync(join(ctx.cwd, 'wake-events.jsonl'), JSON.stringify({ at: Date.now(), ...event }) + '\n');
  for (const name of ['agent_start', 'agent_end', 'tool_execution_start', 'tool_execution_end', 'message_end']) {
    pi.on(name, (event: any, ctx: any) => {
      if (name === 'tool_execution_end' && event.toolName === 'wake_cron') {
        cronDeadline = Date.parse(event.result?.details?.next_at);
        if (!Number.isFinite(cronDeadline)) throw new Error('Missing real cron registration deadline');
      }
      record(ctx, { event: name, toolCallId: event.toolCallId, toolName: event.toolName,
        isError: event.isError, role: event.message?.role, customType: event.message?.customType,
        details: event.message?.customType === 'wakeups' ? event.message.details : undefined });
    });
  }
  pi.registerTool({
    name: 'fixture_batch_hold', label: 'Private batch barrier', description: 'Hold one private batch sibling for a real timer interval.',
    executionMode: mode,
    parameters: { type: 'object', properties: { sibling: { type: 'string' } }, required: ['sibling'], additionalProperties: false },
    async execute(id: string, args: any, signal: AbortSignal, _update: any, ctx: any) {
      record(ctx, { event: 'barrier_enter', sibling: args.sibling, id });
      let holdMs = mode === 'parallel' && args.sibling === 'LAST' ? 3200 : 1600;
      if (schedule === 'cron' && args.sibling === 'FIRST') {
        if (cronDeadline === undefined) throw new Error('Cron deadline not observed');
        holdMs = Math.max(1, cronDeadline - Date.now() + 200);
        if (holdMs > 65000) throw new Error('Cron deadline outside bounded one-minute fixture');
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); record(ctx, { event: 'barrier_abort', sibling: args.sibling }); reject(new Error('batch aborted')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, holdMs);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
      record(ctx, { event: 'barrier_exit', sibling: args.sibling, id });
      return { content: [{ type: 'text', text: `BATCH_RESULT_${args.sibling}` }], details: { sibling: args.sibling } };
    }
  });
}

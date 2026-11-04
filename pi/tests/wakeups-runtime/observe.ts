import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// Observation only: no tools, continuations, messages or timers.
export default function (pi: ExtensionAPI) {
  for (const name of ['session_start', 'before_agent_start', 'tool_call', 'tool_result',
    'message_start', 'message_end', 'agent_settled'] as const) {
    pi.on(name, (event, ctx) => {
      let admission: unknown;
      pi.events.emit('session-lifecycle:admission', { respond: (value: unknown) => { admission = value; } });
      appendFileSync(join(process.env.LIFECYCLE_LAB!, 'wake-observations.jsonl'), JSON.stringify({
        mono: Number(process.hrtime.bigint()) / 1e6, wall: Date.now(), event,
        admission, idle: ctx.isIdle(), pending: ctx.hasPendingMessages(),
        leaf: ctx.sessionManager.getLeafId(), sessionFile: ctx.sessionManager.getSessionFile(),
      }) + '\n');
    });
  }
}

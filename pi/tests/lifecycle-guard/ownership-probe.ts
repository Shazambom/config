import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default function (pi: ExtensionAPI) {
  pi.on('session_start', (event, ctx) => {
    let admission: any;
    pi.events.emit('session-lifecycle:admission', { respond: value => { admission = value; } });
    const branch = JSON.stringify(ctx.sessionManager.getBranch());
    const fresh = branch.includes('History written after contender opened') || branch.includes('Synthetic response before root hangs');
    const record = { pid: process.pid, reason: event.reason, fresh, admission };
    appendFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'ownership-starts.jsonl'), JSON.stringify(record) + '\n');
    // This later-loaded consumer only initializes during replacement startup.
    if (event.reason === 'resume' && fresh && admission?.status === 'owned') {
      appendFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'ownership-startup-ledger.jsonl'), JSON.stringify(record) + '\n');
    }
  });
  pi.on('before_agent_start', (event, ctx) => {
    if (!event.prompt.includes('Successor after verified retirement')) return;
    let admission: any;
    pi.events.emit('session-lifecycle:admission', { respond: value => { admission = value; } });
    writeFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'ownership-probe.json'), JSON.stringify({
      fresh: JSON.stringify(ctx.sessionManager.getBranch()).includes('History written after contender opened'),
      admission,
    }));
  });
}

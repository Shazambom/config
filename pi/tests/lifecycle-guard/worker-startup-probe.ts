import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    let admission: any;
    pi.events.emit('session-lifecycle:admission', { respond: value => { admission = value; } });
    writeFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'worker-startup.json'), JSON.stringify({
      pid: process.pid, sessionFile: ctx.sessionManager.getSessionFile(), admission,
      initialized: admission?.status === 'owned',
    }));
  });
}

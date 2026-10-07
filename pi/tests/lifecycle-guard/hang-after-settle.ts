// Private-lab fixture only. Block this synthetic root after its reply is saved.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function (pi: ExtensionAPI) {
  pi.on('agent_settled', () => {
    setImmediate(() => {
      process.on('SIGTERM', () => {});
      writeFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'root-blocked'), 'synthetic root ignores TERM and blocks its event loop\n');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    });
  });
}

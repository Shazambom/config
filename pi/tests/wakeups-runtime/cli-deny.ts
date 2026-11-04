import { existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// Private fault injection only. The genuine guard remains loaded and untouched.
// A second response makes admission ambiguous; never grants synthetic ownership.
export default function (pi: ExtensionAPI) {
  pi.events.on('session-lifecycle:admission', (request: unknown) => {
    const root = process.env.LIFECYCLE_LAB;
    if (!root || !existsSync(join(root, 'deny-wakeup-admission'))) return;
    const respond = (request as { respond?: (value: unknown) => void })?.respond;
    if (typeof respond !== 'function') return;
    appendFileSync(join(root, 'denied-admissions.jsonl'), JSON.stringify({ wall: Date.now() }) + '\n');
    respond({ managed: true, status: 'blocked' });
  });
}

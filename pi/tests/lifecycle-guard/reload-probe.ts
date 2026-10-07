// Test-only: synthetic disk entry proves that same-file switch reads fresh history.
import { appendFileSync, writeFileSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  const marker = 'SYNTHETIC_FRESH_DISK_BRANCH';
  pi.registerCommand('lifecycle-reload-probe', {
    description: 'Private-lab fresh history probe',
    handler: async (_args, ctx) => {
      const file = ctx.sessionManager.getSessionFile()!;
      const contains = (branch: any[]) => JSON.stringify(branch).includes(marker);
      const leases = join(dirname(realpathSync(file)), '.pi-lifecycle');
      const leaseSnapshot = () => readdirSync(leases).filter(name => name.endsWith('.owner.json')).sort().map(name => readFileSync(join(leases, name), 'utf8')).join('\n');
      const beforeLease = leaseSnapshot();
      const before = contains(ctx.sessionManager.getBranch());
      appendFileSync(file, JSON.stringify({ type: 'message', id: randomUUID(), parentId: ctx.sessionManager.getLeafId(), timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: marker }], timestamp: Date.now() } }) + '\n');
      const stale = contains(ctx.sessionManager.getBranch());
      await ctx.switchSession(file, { withSession: async fresh => {
        writeFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'reload-probe.json'), JSON.stringify({ before, stale, fresh: contains(fresh.sessionManager.getBranch()), retainedLease: beforeLease === leaseSnapshot() }));
      } });
    },
  });
  let armed = false;
  pi.on('session_start', event => { armed = event.reason === 'startup'; });
  pi.on('agent_settled', () => {
    if (!armed) return;
    armed = false;
    setImmediate(() => {
      // Run after lifecycle dispatch, with the original conversation persisted.
      // deliverAs alone does not dispatch a command. Expansion must be explicit.
      pi.sendUserMessage('/lifecycle-reload-probe', { deliverAs: 'followUp', expandPromptTemplates: true });
    });
  });
}

// A later-loaded, cooperating package fixture. It uses only the public bus,
// never the guard's internal globals, helper PID, lock files or implementation.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export function queryAdmission(events: any, belief: { managed: boolean }) {
  let receipt: any;
  let responses = 0;
  try {
    events.emit('session-lifecycle:admission', { respond: (value: any) => { responses++; receipt = value; } });
  } catch { return { status: 'unavailable' }; }
  if (responses) belief.managed = true;
  if (responses !== 1) return { status: belief.managed ? 'unavailable' : 'unmanaged' };
  return receipt?.managed === true ? receipt : { status: 'unavailable' };
}
export function canWrite(receipt: any, expected?: any) {
  if (receipt.status === 'unmanaged') return !expected;
  return receipt.status === 'owned' && typeof receipt.sessionFile === 'string' && typeof receipt.generation === 'string' &&
    (!expected || (receipt.generation === expected.generation && receipt.sessionFile === expected.sessionFile));
}

const key = Symbol.for('portable-pi.admission-consumer-fixture');
export default function (pi: ExtensionAPI) {
  const shared = (globalThis as any)[key] ??= { managed: false, phase: 0 };
  const directory = process.env.PI_CODING_AGENT_DIR!;
  const audit = (value: any) => appendFileSync(join(directory, 'admission-audit.jsonl'), JSON.stringify({ pid: process.pid, ...value }) + '\n');
  const query = () => queryAdmission(pi.events, shared);
  function work(stage: string, expected?: any) {
    const receipt = query();
    const allowed = canWrite(receipt, expected);
    audit({ stage, receipt, expected, allowed });
    // Query/recheck and synchronous write are in one stack, with no await.
    if (allowed) appendFileSync(join(directory, 'admission-ledger.jsonl'), JSON.stringify({ pid: process.pid, stage, ...receipt }) + '\n');
    return { receipt, allowed };
  }
  const queue = (command: string) => setImmediate(() => pi.sendUserMessage(command, { expandPromptTemplates: true, deliverAs: 'followUp' }));
  work('factory');
  pi.on('session_start', (event) => {
    const { receipt } = work(`start:${event.reason}`);
    if (receipt.status === 'owned' && !shared.first) shared.first = receipt;
    if (event.reason === 'reload' && shared.phase === 1) {
      shared.reloadValid = canWrite(receipt, shared.first);
      shared.phase = 2; queue('/admission-same-file');
    } else if (event.reason === 'resume' && shared.phase === 2) {
      shared.sameFileValid = canWrite(receipt, shared.first);
      shared.phase = 3; queue('/admission-new');
    } else if (event.reason === 'new' && shared.phase === 3) {
      queue('/admission-check-stale');
    }
  });
  pi.on('session_shutdown', event => { work(`shutdown:${event.reason}`); });
  pi.on('agent_settled', (_event, ctx) => {
    if (shared.phase === 0 && shared.first && JSON.stringify(ctx.sessionManager.getBranch()).includes('Run admission transitions')) {
      shared.phase = 1; queue('/admission-reload');
    }
  });
  pi.registerCommand('admission-reload', { description: 'Private fixture reload', handler: async (_args, ctx) => { await ctx.reload(); } });
  pi.registerCommand('admission-same-file', { description: 'Private fixture canonical same-file resume', handler: async (_args, ctx) => { await ctx.switchSession(shared.first.sessionFile); } });
  pi.registerCommand('admission-new', { description: 'Private fixture session replacement', handler: async (_args, ctx) => { await ctx.newSession(); } });
  pi.registerCommand('admission-check-stale', {
    description: 'Private fixture receipt recheck', handler: async () => {
      const stale = work('stale-receipt', shared.first);
      writeFileSync(join(directory, 'admission-transitions.json'), JSON.stringify({
        first: shared.first, current: stale.receipt, staleAllowed: stale.allowed,
        reloadValid: shared.reloadValid, sameFileValid: shared.sameFileValid,
      }));
      shared.phase = 4;
    },
  });
}

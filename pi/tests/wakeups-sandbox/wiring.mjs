import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dependencies, scripted, open, deliver, bounded } from './sdk.mjs';
import { Mock } from './mock.mjs';

const [pkg, out] = process.argv.slice(2);
const deps = await dependencies(pkg);
const trace = { messages: [], inputs: [], events: [] };
let requested = false;
let followed = false;
const { runtime, model } = await scripted(deps, trace, messages => {
  if (!requested) {
    requested = true;
    return [{
      name: 'wake_after',
      args: { delay_seconds: 60, reminder: 'Check tea; then remind again in two minutes' },
    }];
  }
  if (!followed && JSON.stringify(messages).includes('wake_due')) {
    followed = true;
    return [{ name: 'wake_after', args: { delay_seconds: 120, reminder: 'Check again' } }];
  }
});
const mock = new Mock({ now: '2026-10-19T12:00:00Z' });
const session = await open(deps, join(out, 'workspaces'), mock, runtime, model, trace);
try {
  await bounded(session, () => session.prompt('Remind me to check tea in one minute.'));
  const result = trace.messages.find(m => m.role === 'toolResult');
  assert.equal(result?.isError, false, 'SDK registration must succeed');
  assert.equal(result.details.status, 'registered');
  const event = mock.advance(60)[0];
  trace.events.push(event);
  await bounded(session, () => deliver(session, event));
  assert(trace.inputs.some(input => JSON.stringify(input).includes('wake_due')), 'provider must receive event');
  assert.equal(trace.messages.filter(m => m.role === 'toolResult' && !m.isError).length,
    2, 'event must produce successful followup');
  console.log('PASS SDK call/result/event/provider/followup');
} finally {
  writeFileSync(join(out, 'trace.json'), JSON.stringify(trace, null, 2));
  session.dispose();
}

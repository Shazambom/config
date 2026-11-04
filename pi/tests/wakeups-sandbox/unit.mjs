import assert from 'node:assert/strict';
import { Mock } from './mock.mjs';
import { Scorer } from './score.mjs';

export function unitTests() {
  const fixture = { now: '2026-10-19T12:00:00Z' };
  const mock = new Mock(fixture);
  assert.deepEqual(mock.call('wake_after', { delay_seconds: 120, reminder: 'Tea' }), {
    job_id: 'timer-1', kind: 'after', next_at: '2026-10-19T12:02:00.000Z', status: 'registered',
  });
  assert.deepEqual(mock.advance(119), []);
  assert.deepEqual(mock.advance(1), [{
    kind: 'wake_due', job_id: 'timer-1', schedule_kind: 'after',
    due_at: '2026-10-19T12:02:00.000Z', observed_at: '2026-10-19T12:02:00.000Z', reminder: 'Tea',
  }]);
  assert.deepEqual(mock.advance(120), []);
  const recurring = new Mock(fixture);
  recurring.call('wake_every', { every_seconds: 60, reminder: 'Stretch' });
  assert.equal(recurring.advance(180).length, 1, 'late periods coalesce');
  assert.equal(recurring.advance(59).length, 0);
  assert.equal(recurring.advance(1).length, 1);
  recurring.call('wake_cancel', { job_id: 'timer-1' });
  assert.equal(recurring.advance(600).length, 0);
  assert.throws(() => recurring.call('wake_cancel', { job_id: 'timer-1' }), /UNKNOWN_TIMER/);
  const shell = new Mock(fixture);
  assert.deepEqual(shell.call('watch_shell', { command: './x', on_exit: 'Report' }), {
    process_id: 'process-1', status: 'running',
  });
  assert.throws(() => shell.exit({ exit_code: 0, signal: 'SIGTERM' }), /INVALID_TERMINATION/);
  assert.deepEqual(shell.exit({ signal: 'SIGTERM' }).termination, { signal: 'SIGTERM' });
  assert.throws(() => shell.exit({ exit_code: 0 }), /NOT_RUNNING/);
  const step = {
    input: { user: 'Remind me in two minutes.' },
    expect: { calls: [{ name: 'wake_after', args: { delay_seconds: 120 } }], events: 0, textRequired: true },
  };
  const receipt = {
    job_id: 'literal-handle', kind: 'after', next_at: '2026-10-19T12:02:00.000Z', status: 'registered',
  };
  const call = {
    type: 'toolCall', id: 'c1', name: 'wake_after', arguments: { delay_seconds: 120, reminder: 'Tea' },
  };
  const result = {
    role: 'toolResult', toolCallId: 'c1', toolName: 'wake_after', isError: false,
    details: receipt, content: [{ type: 'text', text: JSON.stringify(receipt) }],
  };
  const good = {
    messages: [
      { role: 'assistant', content: [call] }, result,
      { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Registered' }] },
    ],
    inputs: [[{ role: 'user', content: step.input.user }, result]],
    events: [],
  };
  good.history = good.messages;
  assert.equal(new Scorer(fixture).step(step, structuredClone(good)), 'PASS');
  const mutations = {
    'false-claim': p => { p.messages = p.messages.slice(-1); },
    'wrong-units': p => { p.messages[0].content[0].arguments.delay_seconds = 120000; },
    'milliseconds-next': p => {
      p.messages[1].details.next_at = '2026-10-19T12:00:00.120Z';
      p.messages[1].content[0].text = JSON.stringify(p.messages[1].details);
    },
    'duplicate': p => { p.messages[0].content.push({ ...call, id: 'c2' }); },
    'forbidden': p => { p.messages[0].content[0].name = 'bash'; },
    'tool-error': p => { p.messages[1].isError = true; },
    'missing-result': p => { p.messages.splice(1, 1); },
    'unconsumed-result': p => { p.inputs = []; },
    'missing-reply': p => { p.messages.pop(); },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const phase = structuredClone(good);
    mutate(phase);
    assert.throws(() => new Scorer(fixture).step(step, phase), undefined, name);
  }
  console.log(`PASS independent mock assertions and ${Object.keys(mutations).length} scorer rejection controls`);
}

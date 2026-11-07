import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function wakeupsFixture(work, reply, task) {
  const marker = `REAL_RECURRING_${task}`;
  const { mode, schedule } = JSON.parse(readFileSync(join(work, 'wake-mode.json'), 'utf8'));
  let phase = 0, job, idleJob, checked;
  const idleMarker = `IDLE_${marker}`;
  const lastTool = tools => {
    const result = tools.at(-1);
    assert(result, 'tool result present');
    return JSON.parse(typeof result.content === 'string' ? result.content : result.content.map(p => p.text ?? '').join(''));
  };
  const events = () => readFileSync(join(work, 'workspace/wake-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const text = value => typeof value === 'string' ? value : JSON.stringify(value);
  return {
    setRoot() {},
    async decide(input) {
      const tools = input.messages.filter(m => m.role === 'tool');
      if (phase === 0) {
        phase++;
        return schedule === 'cron'
          ? { tool: 'wake_cron', args: { expression: '* * * * *', timezone: 'UTC', reminder: marker } }
          : { tool: 'wake_every', args: { every_seconds: 1, reminder: marker } };
      }
      if (phase === 1) {
        const receipt = tools.find(m => text(m.content).includes('job_id'));
        assert(receipt, 'real wake_every result reached provider');
        const content = typeof receipt.content === 'string' ? receipt.content : receipt.content.map(p => p.text ?? '').join('');
        job = JSON.parse(content).job_id;
        assert(job, 'real timer registered');
        phase++;
        return { calls: ['FIRST', 'LAST'].map(sibling => ({ tool: 'fixture_batch_hold', args: { sibling } })) };
      }
      if (phase === 2) {
        const firstInput = join(work, 'wake-next-provider-input.json');
        if (!existsSync(firstInput)) writeFileSync(firstInput, JSON.stringify(input, null, 2));
        const observed = events();
        assert.equal(observed.filter(e => e.event === 'barrier_exit').length, 2, 'whole held batch completed before next provider input');
        assert.equal(observed.filter(e => e.event === 'barrier_abort').length, 0, 'no sibling command aborted');
        const at = (event, sibling) => observed.findIndex(e => e.event === event && e.sibling === sibling);
        if (mode === 'parallel') {
          assert(at('barrier_enter', 'LAST') < at('barrier_exit', 'FIRST'), 'actual native parallel overlap');
        } else {
          assert(at('barrier_enter', 'LAST') > at('barrier_exit', 'FIRST'), 'actual native sequential siblings');
        }
        assert(tools.some(m => text(m.content).includes('BATCH_RESULT_FIRST')), 'first sibling result preserved');
        assert(tools.some(m => text(m.content).includes('BATCH_RESULT_LAST')), 'last sibling result preserved');
        assert(input.messages.some(m => m.role === 'user' && text(m.content).includes(task)), 'original task preserved');
        const notices = input.messages.filter(m => m.role === 'user' && text(m.content).includes('wake_due') && text(m.content).includes(marker));
        assert(notices.length > 0, 'real recurring reminder reached next provider input before agent_end');
        assert.equal(observed.filter(e => e.event === 'agent_end').length, 0, 'reminder did not wait for whole agent run to end');
        checked = { job, marker, mode, schedule, siblings: 2, noAbort: true, reminderBeforeAgentEnd: true };
        phase++;
        return { tool: 'wake_cancel', args: { job_id: job } };
      }
      if (phase === 3) {
        const cancelled = lastTool(tools);
        assert.equal(cancelled.job_id, job);
        assert.equal(cancelled.status, 'cancelled_future_only', 'busy timer cancellation acknowledged');
        phase++;
        return { tool: 'wake_every', args: { every_seconds: 1, reminder: idleMarker } };
      }
      if (phase === 4) {
        idleJob = lastTool(tools).job_id;
        assert(idleJob, 'idle control registered');
        phase++;
        return { text: 'IDLE_WAIT_FOR_REAL_TIMER' };
      }
      if (phase === 5) {
        writeFileSync(join(work, 'idle-next-provider-input.json'), JSON.stringify(input, null, 2));
        assert(events().some(e => e.event === 'agent_end'), 'idle control has actually settled first');
        assert(input.messages.some(m => m.role === 'user' && text(m.content).includes('wake_due') && text(m.content).includes(idleMarker)), 'idle real recurrence autonomously reaches provider');
        phase++;
        return { tool: 'wake_cancel', args: { job_id: idleJob } };
      }
      assert.equal(phase, 6, 'no unexpected autonomous provider requests');
      const cancelled = lastTool(tools);
      assert.equal(cancelled.job_id, idleJob);
      assert.equal(cancelled.status, 'cancelled_future_only', 'idle cancellation acknowledged');
      phase++;
      return { text: reply };
    },
    verify() { assert(checked, 'busy timer assertions completed'); assert.equal(phase, 7); return { ...checked, idleAutonomous: true, busyAndIdleCancellationAcknowledged: true }; }
  };
}

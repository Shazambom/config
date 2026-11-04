import assert from 'node:assert/strict';

const canonical = v => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v;
const parse = m => JSON.parse(m.content.find(c => c.type === 'text').text);

export class Scorer {
  constructor(fixture) {
    this.fixture = fixture;
    this.now = Date.parse(fixture.now);
    this.created = undefined;
    this.known = new Set();
    this.handles = new Set((fixture.initialTimers ?? []).map(t => t.job_id));
    this.timers = new Map((fixture.initialTimers ?? []).map(t => [t.job_id, {
      ...t, next: Date.parse(fixture.now) + 1000 * (t.every_seconds ?? t.delay_seconds ?? 0),
    }]));
  }

  step(step, phase) {
    const { messages, inputs, events, history } = phase;
    assert(Array.isArray(inputs) && Array.isArray(history), 'MISSING_OBSERVATION');
    assert(!messages.some(m => m.role === 'assistant' &&
      ['error', 'aborted'].includes(m.stopReason)), 'INFRA_PROVIDER');
    const wanted = this.expectedEvents(step);
    const knownBefore = new Set(this.known);
    const calls = messages.flatMap(m =>
      m.role === 'assistant' ? m.content.filter(c => c.type === 'toolCall') : []);
    const results = messages.filter(m => m.role === 'toolResult');
    assert(!results.some(r => r.isError), 'TOOL_ERROR');
    assert.equal(new Set(calls.map(c => c.id)).size, calls.length, 'DUPLICATE_CALL_ID');
    const expected = step.expect.calls.slice();
    for (const c of calls) {
      let index = expected.findIndex(e => e.name === c.name);
      if (index < 0 && c.name === 'wake_list' && step.expect.allowList) index = -2;
      assert(index !== -1, 'UNEXPECTED_CALL');
      const e = index === -2 ? {} : expected.splice(index, 1)[0];
      for (const [key, value] of Object.entries(e.args ?? {})) {
        const normalize = key === 'expression' ? canonical : v => v;
        assert.equal(normalize(c.arguments[key]),
          normalize(value === '$created_timer' ? this.created : value), `WRONG_${key}`);
      }
      for (const [key, values] of Object.entries(e.oneOf ?? {})) {
        const normalize = key === 'expression' ? canonical : v => v;
        assert(values.map(normalize).includes(normalize(c.arguments[key])), `WRONG_${key}`);
      }
      const matches = results.filter(r => r.toolCallId === c.id && r.toolName === c.name);
      assert.equal(matches.length, 1, 'MISSING_OR_DUPLICATE_RESULT');
      const r = matches[0];
      const receipt = parse(r);
      assert.deepEqual(receipt, r.details, 'RECEIPT_DETAILS');
      assert.equal(history.filter(m => m.role === 'toolResult' && m.toolCallId === r.toolCallId &&
        JSON.stringify(m.content) === JSON.stringify(r.content)).length, 1, 'RESULT_HISTORY');
      assert(messages.indexOf(r) > messages.findIndex(m =>
        m.role === 'assistant' && m.content.includes(c)), 'RESULT_ORDER');
      assert(inputs.some(ms => ms.some(m => m.role === 'toolResult' && m.toolCallId === c.id &&
        JSON.stringify(m.content) === JSON.stringify(r.content))), 'RESULT_NOT_CONSUMED');
      if (c.name === 'wake_list') {
        assert.deepEqual(receipt.timers, [...this.timers.values()].map(t => ({
          job_id: t.job_id, kind: t.kind, reminder: t.reminder,
          next_at: new Date(t.next).toISOString(),
        })), 'LIST_FACTS');
        for (const t of receipt.timers) this.known.add(t.job_id);
      } else if (c.name === 'wake_cancel') {
        assert(this.known.has(c.arguments.job_id), 'UNDISCLOSED_ID');
        if (!knownBefore.has(c.arguments.job_id)) {
          const callIndex = messages.findIndex(m => m.role === 'assistant' && m.content.includes(c));
          assert(messages.slice(0, callIndex).some(m => m.role === 'toolResult' && !m.isError &&
            JSON.stringify(m.content).includes(c.arguments.job_id)), 'ID_NOT_YET_PUBLISHED');
        }
        assert(this.timers.delete(c.arguments.job_id), 'STALE_ID');
        assert.deepEqual(receipt, { job_id: c.arguments.job_id, status: 'cancelled_future_only' });
      } else if (c.name === 'watch_shell') {
        assert.equal(receipt.status, 'running');
        assert.equal(typeof receipt.process_id, 'string');
        assert(!this.process, 'DUPLICATE_PROCESS');
        assert(!this.handles.has(receipt.process_id), 'REUSED_HANDLE');
        this.handles.add(receipt.process_id);
        this.process = { ...c.arguments, ...receipt };
      } else {
        const kind = { wake_after: 'after', wake_every: 'every', wake_cron: 'cron' }[c.name];
        assert(kind, 'FORBIDDEN_TOOL');
        assert.equal(receipt.kind, kind);
        assert.equal(receipt.status, 'registered');
        assert.equal(typeof receipt.job_id, 'string');
        assert(receipt.job_id.length);
        assert(!this.handles.has(receipt.job_id), 'REUSED_HANDLE');
        this.handles.add(receipt.job_id);
        this.known.add(receipt.job_id);
        this.created = receipt.job_id;
        const next = kind === 'cron'
          ? Date.parse(this.fixture.cronSlots.find(s => Date.parse(s) > this.now))
          : this.now + 1000 * (c.arguments.delay_seconds ?? c.arguments.every_seconds);
        assert.equal(Date.parse(receipt.next_at), next, 'WRONG_NEXT');
        this.timers.set(receipt.job_id, { ...c.arguments, kind, next, job_id: receipt.job_id });
      }
    }
    assert.equal(expected.length, 0, 'MISSING_CALL');
    assert.equal(results.length, calls.length, 'ORPHAN_RESULT');
    assert.equal(wanted.length, step.expect.events, 'FIXTURE_EVENT_COUNT');
    assert.deepEqual(events, wanted, 'WRONG_EVENT');
    const historyEvents = messages.filter(m => m.role === 'custom' && m.customType === 'wakeups')
      .map(m => JSON.parse(m.content));
    assert.deepEqual(historyEvents, wanted, 'EVENT_HISTORY');
    assert.deepEqual(history.filter(m => m.role === 'custom' && m.customType === 'wakeups')
      .map(m => JSON.parse(m.content)), wanted, 'PERSISTED_EVENT_HISTORY');
    for (const event of wanted) {
      assert(inputs.some(ms => ms.some(m => m.role === 'user' &&
        (typeof m.content === 'string' ? m.content : m.content.map(c => c.text ?? '').join(''))
          .includes(JSON.stringify(event)))), 'EVENT_NOT_CONSUMED');
      const eventIndex = messages.findIndex(m => m.role === 'custom' && m.content === JSON.stringify(event));
      assert(messages.slice(eventIndex + 1).some(m => m.role === 'assistant' &&
        (!step.expect.textRequired || (m.stopReason === 'stop' &&
          m.content.some(c => c.type === 'text' && c.text.trim())))), 'NO_EVENT_REPLY');
    }
    if (step.expect.textRequired) {
      assert(messages.some(m => m.role === 'assistant' && m.stopReason === 'stop' &&
        m.content.some(c => c.type === 'text' && c.text.trim())), 'MISSING_NEW_REPLY');
    }
    const original = step.input.user ?? step.input.progress ?? step.input.busy?.user;
    if (original) {
      assert(inputs.some(ms => ms.some(message => message.role === 'user' &&
        (typeof message.content === 'string'
          ? message.content
          : message.content.filter(block => block.type === 'text').map(block => block.text).join('')) === original)),
      'ORIGINAL_TASK_LOST');
    }
    return 'PASS';
  }

  expectedEvents(step) {
    const wanted = [];
    if (step.input.advance_seconds !== undefined || step.input.cron_tick) {
      this.now = step.input.cron_tick
        ? Date.parse(step.input.cron_tick)
        : this.now + 1000 * step.input.advance_seconds;
      for (const t of this.timers.values()) {
        if ((t.kind === 'cron') !== !!step.input.cron_tick || t.next > this.now) continue;
        wanted.push({
          kind: 'wake_due', job_id: t.job_id, schedule_kind: t.kind,
          due_at: new Date(t.next).toISOString(), observed_at: new Date(this.now).toISOString(),
          reminder: t.reminder,
        });
        if (t.kind === 'after') {
          this.timers.delete(t.job_id);
        } else if (t.kind === 'every') {
          while (t.next <= this.now) t.next += 1000 * t.every_seconds;
        } else {
          t.next = Date.parse(this.fixture.cronSlots.find(s => Date.parse(s) > this.now)) || Infinity;
        }
      }
    }
    const termination = step.input.exit ?? step.input.busy?.exit;
    if (termination) {
      assert.equal(this.process?.status, 'running', 'NO_RUNNING_PROCESS');
      wanted.push({
        kind: 'shell_exit', process_id: this.process.process_id, termination,
        stdout_tail: '', stderr_tail: '', stdout_dropped_bytes: 0, stderr_dropped_bytes: 0,
        output_incomplete: false, on_exit: this.process.on_exit,
      });
      this.process.status = 'exited';
    }
    return wanted;
  }
}

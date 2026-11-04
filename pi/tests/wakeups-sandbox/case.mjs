import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Mock } from './mock.mjs';
import { Scorer } from './score.mjs';
import { open, scripted, deliver, bounded, clean } from './sdk.mjs';

export async function runCase(deps, fixture, dir, workspaceRoot, live, mutation) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const trace = {
    id: fixture.id,
    model: live ? `${live.model.provider}/${live.model.id}` : 'sandbox-script/wiring',
    messages: [], inputs: [], events: [], phases: [], status: 'INCOMPLETE',
  };
  const mock = new Mock(fixture);
  const scorer = new Scorer(fixture);
  if (mutation === 'tool-error') {
    mock.call = () => { throw new Error('LAUNCH_FAILED'); };
  }
  let queue = [];
  let release, gate, started;
  let connection = live;
  if (!live) {
    connection = await scripted(deps, trace, () => {
      const expected = queue.shift();
      if (!expected) return;
      const args = { ...(expected.args ?? {}) };
      for (const [key, values] of Object.entries(expected.oneOf ?? {})) args[key] = values[0];
      if (args.job_id === '$created_timer') {
        args.job_id = trace.messages.filter(m =>
          m.role === 'toolResult' && m.details?.status === 'registered').at(-1)?.details.job_id;
      }
      if (expected.name.startsWith('wake_') && !['wake_list', 'wake_cancel'].includes(expected.name)) {
        args.reminder = 'Deliver original reminder';
      }
      if (expected.name === 'watch_shell') args.on_exit = 'Follow original exit instruction';
      if (mutation === 'wrong-units' && args.delay_seconds) args.delay_seconds *= 1000;
      if (mutation === 'invalid-args') args.delay_seconds = 0;
      const action = { name: mutation === 'forbidden-tool' ? 'bash' : expected.name, args };
      return mutation === 'duplicate' ? [action, action] : [action];
    }, () => {
      started?.();
      return gate;
    });
  }
  // Record the actual runtime request boundary, not a reconstructed conversation.
  let restore;
  if (live) {
    const original = live.runtime.streamSimple;
    live.runtime.streamSimple = function(model, context, options) {
      assert.equal(options.transport, 'sse');
      assert.equal(options.maxRetries, 0);
      trace.inputs.push(context.messages.map(clean));
      return original.call(this, model, context, options);
    };
    restore = () => { live.runtime.streamSimple = original; };
  }
  let session;
  try {
    session = await open(deps, workspaceRoot, mock, connection.runtime, connection.model, trace);
    for (let i = 0; i < fixture.steps.length; i++) {
      const step = fixture.steps[i];
      const m = trace.messages.length;
      const p = trace.inputs.length;
      const h = session.messages.length;
      queue = step.expect.calls.slice();
      if ((mutation === 'rearm' && step.expect.events) || (mutation === 'premature' && step.input.progress)) {
        queue.push({ name: 'wake_after', args: { delay_seconds: 60 } });
      }
      let events = [];
      if (step.input.advance_seconds !== undefined) events = mock.advance(step.input.advance_seconds);
      if (step.input.cron_tick) events = mock.cron(step.input.cron_tick);
      if (step.input.exit) events = [mock.exit(step.input.exit)];
      if (mutation === 'cancelled-handle') {
        events = events.map(event => ({ ...event, job_id: fixture.initialTimers[0].job_id }));
      }
      if (step.input.busy) {
        let observed;
        const began = new Promise(resolve => { observed = resolve; });
        const off = session.subscribe(e => {
          if (live && e.type === 'agent_start') observed();
        });
        if (!live) {
          started = observed;
          gate = new Promise(resolve => { release = resolve; });
        }
        const prompt = session.prompt(step.input.busy.user);
        await bounded(session, async () => {
          await began;
          off();
          started = undefined;
          events = [mock.exit(step.input.busy.exit)];
          if (mutation !== 'busy-missing-event') await deliver(session, events[0]);
          release?.();
          gate = undefined;
          await prompt;
        });
      } else {
        if (step.input.user || step.input.progress) {
          await bounded(session, () => session.prompt(step.input.user ?? step.input.progress));
        }
        for (const event of events) {
          if (mutation === 'missing-event' || (mutation === 'missing-third-event' && i === 3)) continue;
          const sent = mutation === 'wrong-event-id'
            ? { ...event, job_id: 'stale-handle' }
            : mutation === 'wrong-event-facts'
              ? { ...event, observed_at: '2000-01-01T00:00:00Z' }
              : event;
          await bounded(session, () => deliver(session, sent, mutation !== 'missing-trigger'));
        }
      }
      trace.events.push(...events);
      const phase = {
        messages: trace.messages.slice(m), inputs: trace.inputs.slice(p),
        history: session.messages.slice(h).map(clean), events,
      };
      if (mutation === 'stale-reply' && events.length) {
        phase.messages = phase.messages.filter(msg => msg.role !== 'assistant');
      }
      trace.phases.push(phase);
      try {
        if (trace.limitExceeded) throw new Error('CALL_LIMIT');
        if (live && phase.messages.some(m => m.role === 'assistant' &&
          (m.provider !== live.model.provider || m.model !== live.model.id))) {
          throw new Error('INFRA_MODEL_CHANGED');
        }
        scorer.step(step, phase);
      } catch (error) {
        trace.firstFailure = { step: i, code: String(error.message).split('\n')[0] };
        trace.status = /INFRA_|MISSING_OBSERVATION/.test(error.message) ? 'INCOMPLETE' : 'FAIL';
        return trace;
      }
    }
    trace.status = 'PASS';
    return trace;
  } catch {
    trace.status = 'INCOMPLETE';
    trace.firstFailure = { code: 'SDK_OR_FIXTURE_ERROR' };
    return trace;
  } finally {
    release?.();
    session?.dispose();
    restore?.();
    trace.history = session?.messages.map(clean) ?? [];
    writeFileSync(join(dir, 'trace.json'), JSON.stringify(trace, null, 2));
  }
}

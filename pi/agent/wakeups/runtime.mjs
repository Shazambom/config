import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createCron } from './cron.mjs';

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_JOBS = 32;
const CRON_RECHECK_MS = 30_000;
const result = details => ({ content: [{ type: 'text', text: JSON.stringify(details) }], details });

export default function install(pi, definitions) {
  const jobs = new Map();
  let incarnation;
  let busy = false;

  function readOwner() {
    let snapshot;
    let replies = 0;
    try {
      pi.events.emit('session-lifecycle:admission', {
        respond(value) { replies++; snapshot = value; },
      });
    } catch { return; }
    if (replies === 1 && snapshot?.managed === true && snapshot.status === 'owned' &&
        typeof snapshot.sessionFile === 'string' && snapshot.sessionFile &&
        typeof snapshot.generation === 'string' && snapshot.generation) {
      return { sessionFile: snapshot.sessionFile, generation: snapshot.generation };
    }
  }

  function warn(job, message) {
    try { job.ctx.ui.notify(message, 'warning'); } catch { /* Retiring UI. */ }
  }

  function stop() {
    incarnation = undefined;
    busy = false;
    for (const job of jobs.values()) clearTimeout(job.timer);
    jobs.clear();
  }

  function cancel(job) {
    clearTimeout(job.timer);
    job.cancelled = true;
    job.pending = undefined;
    // A native queued message cannot be recalled and still occupies capacity.
    if (!job.submitted) jobs.delete(job.id);
  }

  function isCurrent(expectedOwner, expectedIncarnation) {
    const owner = readOwner();
    return !!incarnation && incarnation === expectedIncarnation && !!owner &&
      owner.sessionFile === expectedOwner?.sessionFile && owner.generation === expectedOwner?.generation;
  }

  function current(job) {
    return jobs.get(job.id) === job && isCurrent(job.owner, job.incarnation);
  }

  function dispatch(job) {
    if (job.cancelled || !job.pending || job.submitted || (busy && job.kind !== 'after')) return;
    if (!current(job)) {
      cancel(job);
      warn(job, 'Wakeup cancelled because session ownership changed.');
      return;
    }
    const event = job.pending;
    job.pending = undefined;
    job.submitted = event;
    try {
      // This API returns void. Async failures go to Pi's extension-error channel;
      // absent message_end, retain the slot and never blindly resubmit.
      pi.sendMessage({ customType: 'wakeups', content: JSON.stringify(event), display: true, details: event },
        { triggerTurn: true, deliverAs: 'followUp' });
    } catch {
      job.submitted = undefined;
      cancel(job);
      warn(job, 'Wakeup could not be submitted.');
    }
  }

  function arm(job) {
    job.timer = setTimeout(() => {
      if (incarnation !== job.incarnation || jobs.get(job.id) !== job || job.cancelled) return;
      const now = job.kind === 'cron' ? Date.now() : performance.now();
      if (job.deadline > now) { arm(job); return; }
      if (!current(job)) {
        cancel(job);
        warn(job, 'Wakeup cancelled because session ownership changed.');
        return;
      }
      const due = job.nextAt;
      if (job.kind === 'every') {
        const periods = Math.floor((now - job.deadline) / job.period) + 1;
        job.deadline += periods * job.period;
        job.nextAt = new Date(Date.parse(job.nextAt) + periods * job.period).toISOString();
        arm(job);
      } else if (job.kind === 'cron') {
        try {
          job.deadline = job.cron.next(now);
          job.nextAt = new Date(job.deadline).toISOString();
          arm(job);
        } catch {
          cancel(job);
          warn(job, 'Wakeup cancelled because its next calendar occurrence could not be calculated.');
          return;
        }
      }
      job.pending = { kind: 'wake_due', job_id: job.id, schedule_kind: job.kind,
        due_at: due, observed_at: new Date().toISOString(), reminder: job.reminder };
      dispatch(job);
    }, Math.min(job.kind === 'cron' ? CRON_RECHECK_MS : MAX_TIMEOUT_MS,
      Math.max(1, Math.ceil(job.deadline - (job.kind === 'cron' ? Date.now() : performance.now())))));
    job.timer.unref();
  }

  pi.on('session_start', () => { stop(); incarnation = {}; });
  pi.on('session_shutdown', stop);
  pi.on('agent_start', () => { busy = true; });
  pi.on('agent_end', () => {
    busy = false;
    for (const job of jobs.values()) dispatch(job);
  });
  pi.on('message_end', ({ message }) => {
    if (message.role !== 'custom' || message.customType !== 'wakeups') return;
    const job = jobs.get(message.details?.job_id);
    if (!job?.submitted || message.details?.due_at !== job.submitted.due_at) return;
    // Committed to Pi's message flow, not durable-save or model-consumption ACK.
    job.submitted = undefined;
    if (job.kind === 'after' || job.cancelled) jobs.delete(job.id);
    else dispatch(job);
  });

  for (const definition of Array.isArray(definitions) ? definitions : [definitions]) {
    if (!['wake_after', 'wake_every', 'wake_cron', 'wake_list', 'wake_cancel'].includes(definition.name)) continue;
    pi.registerTool({
      ...definition,
      label: definition.name.replaceAll('_', ' '),
      executionMode: 'sequential',
      promptGuidelines: [
        ...(definition.promptGuidelines ?? []),
        'Wakeups belong to the current runtime. Closing or reloading cancels unsent reminders. Registration is not delivery; register recurrence once, and do not sleep, poll or rearm while waiting.',
      ],
      async execute(_callId, args, _signal, _update, ctx) {
        const owner = readOwner();
        if (!incarnation || !owner) throw new Error('WAKEUPS_OWNERSHIP_REQUIRED');
        if (ctx.mode !== 'tui' && ctx.mode !== 'rpc') throw new Error('WAKEUPS_PERSISTENT_MODE_REQUIRED');
        if (definition.name === 'wake_list') {
          return result({ timers: [...jobs.values()].filter(job => !job.cancelled && current(job)).map(job => ({
            job_id: job.id, kind: job.kind, reminder: job.reminder, next_at: job.nextAt,
          })) });
        }
        if (definition.name === 'wake_cancel') {
          const job = jobs.get(args.job_id);
          if (!job || !current(job)) throw new Error('WAKEUPS_JOB_NOT_FOUND');
          cancel(job);
          return result({ job_id: job.id, status: 'cancelled_future_only' });
        }
        const kind = definition.name.slice('wake_'.length);
        const seconds = kind === 'after' ? args.delay_seconds : args.every_seconds;
        if ((kind !== 'cron' && (!Number.isInteger(seconds) || seconds < 1 || seconds > 31536000)) ||
            typeof args.reminder !== 'string' || !args.reminder.length || args.reminder.length > 2000) {
          throw new Error('WAKEUPS_INVALID_ARGUMENT');
        }
        if (jobs.size >= MAX_JOBS) throw new Error('WAKEUPS_CAPACITY_REACHED');
        const now = Date.now();
        const period = kind === 'cron' ? undefined : seconds * 1000;
        const cron = kind === 'cron' ? createCron(args.expression, args.timezone, now) : undefined;
        const deadline = cron ? cron.next(now) : performance.now() + period;
        const nextAt = new Date(cron ? deadline : now + period).toISOString();
        const job = { id: randomUUID(), kind, reminder: args.reminder, owner, incarnation, ctx, nextAt,
          period, cron, deadline };
        jobs.set(job.id, job);
        arm(job);
        return result({ job_id: job.id, kind, next_at: nextAt, status: 'registered' });
      },
    });
  }
  return { readOwner, getIncarnation: () => incarnation, isCurrent };
}

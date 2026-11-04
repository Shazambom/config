export class Mock {
  constructor(fixture) {
    this.fixture = fixture;
    this.now = Date.parse(fixture.now);
    this.timers = new Map();
    this.serial = 0;
    for (const timer of fixture.initialTimers ?? []) {
      this.timers.set(timer.job_id, {
        ...timer,
        next: this.now + (timer.every_seconds ?? timer.delay_seconds ?? 0) * 1000,
      });
    }
  }

  call(name, args) {
    if (name === 'wake_list') {
      return {
        timers: [...this.timers.values()].map(t => ({
          job_id: t.job_id, kind: t.kind, reminder: t.reminder,
          next_at: new Date(t.next).toISOString(),
        })),
      };
    }
    if (name === 'wake_cancel') {
      if (!this.timers.delete(args.job_id)) throw new Error('UNKNOWN_TIMER');
      return { job_id: args.job_id, status: 'cancelled_future_only' };
    }
    if (name === 'watch_shell') {
      if (this.process) throw new Error('ALREADY_LAUNCHED');
      // Commands are inert strings. The scorer compares them to literal fixture commands.
      this.process = { ...args, process_id: `process-${++this.serial}`, running: true };
      return { process_id: this.process.process_id, status: 'running' };
    }
    const kind = { wake_after: 'after', wake_every: 'every', wake_cron: 'cron' }[name];
    if (!kind) throw new Error('UNKNOWN_TOOL');
    if (kind === 'cron') {
      if (!/^[\d*,/\-]+(?:\s+[\d*,/\-]+){4}$/.test(args.expression.trim())) {
        throw new Error('INVALID_CRON');
      }
      try {
        new Intl.DateTimeFormat('en', { timeZone: args.timezone });
      } catch {
        throw new Error('INVALID_ZONE');
      }
    }
    const next = kind === 'cron'
      ? Date.parse((this.fixture.cronSlots ?? []).find(t => Date.parse(t) > this.now))
      : this.now + (args.delay_seconds ?? args.every_seconds) * 1000;
    if (!Number.isFinite(next)) throw new Error('NO_FIXTURE_OCCURRENCE');
    const job_id = `timer-${++this.serial}`;
    this.timers.set(job_id, { ...args, job_id, kind, next });
    return { job_id, kind, next_at: new Date(next).toISOString(), status: 'registered' };
  }

  advance(seconds) {
    this.now += seconds * 1000;
    return this.due(false);
  }

  cron(instant) {
    if (!(this.fixture.cronSlots ?? []).includes(instant)) throw new Error('UNKNOWN_CRON_SLOT');
    this.now = Date.parse(instant);
    return this.due(true);
  }

  due(cron) {
    const events = [];
    for (const t of this.timers.values()) {
      if ((t.kind === 'cron') !== cron || t.next > this.now) continue;
      events.push({
        kind: 'wake_due', job_id: t.job_id, schedule_kind: t.kind,
        due_at: new Date(t.next).toISOString(), observed_at: new Date(this.now).toISOString(),
        reminder: t.reminder,
      });
      if (t.kind === 'after') {
        this.timers.delete(t.job_id);
      } else if (t.kind === 'every') {
        t.next += (Math.floor((this.now - t.next) / (t.every_seconds * 1000)) + 1) * t.every_seconds * 1000;
      } else {
        t.next = Date.parse((this.fixture.cronSlots ?? []).find(s => Date.parse(s) > this.now)) || Infinity;
      }
    }
    return events;
  }

  exit(termination) {
    if (!this.process?.running) throw new Error('NOT_RUNNING');
    const keys = termination && typeof termination === 'object' ? Object.keys(termination) : [];
    const valid = keys.length === 1 && (
      (keys[0] === 'exit_code' && Number.isInteger(termination.exit_code)) ||
      (keys[0] === 'signal' && typeof termination.signal === 'string' && termination.signal.length > 0)
    );
    if (!valid) throw new Error('INVALID_TERMINATION');
    this.process.running = false;
    return {
      kind: 'shell_exit', process_id: this.process.process_id, termination,
      stdout_tail: '', stderr_tail: '', stdout_dropped_bytes: 0, stderr_dropped_bytes: 0,
      output_incomplete: false, on_exit: this.process.on_exit,
    };
  }
}

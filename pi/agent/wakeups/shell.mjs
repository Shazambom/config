import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const MAX_PROCESSES = 8;
const LAUNCH_TIMEOUT_MS = 3000;
const SHUTDOWN_TIMEOUT_MS = 2000;
const OWNER_CHECK_MS = 250;
const result = details => ({ content: [{ type: 'text', text: JSON.stringify(details) }], details });

// getShellConfig is the public Pi SDK export, injected by the extension entrypoint.
// No SDK/auth/extension loading takes place in the builtin-only helper.
export default function installShell(pi, definition, lifecycle, { getShellConfig }) {
  const jobs = new Map();
  const helpers = new Set();
  function current(job) {
    return !job.cancelled && jobs.get(job.id) === job && lifecycle.isCurrent(job.owner, job.incarnation);
  }
  function warn(job, text) { try { job.ctx.ui.notify(text, 'warning'); } catch {} }
  function requestStop(job) {
    job.cancelled = true;
    clearInterval(job.monitor);
    if (!job.helperFinished && job.helper?.connected) {
      try { job.helper.send({ type: 'stop' }, () => {}); job.helper.disconnect(); } catch {}
    }
  }
  function publish(job) {
    if (!job.committed || !job.pending || job.submitted) return;
    if (!current(job)) { requestStop(job); jobs.delete(job.id); return; }
    job.submitted = true;
    try {
      const event = { kind: 'shell_exit', process_id: job.id, ...job.pending, on_exit: job.onExit };
      pi.sendMessage({ customType: 'wakeups', content: JSON.stringify(event), display: true, details: event },
        { triggerTurn: true, deliverAs: 'followUp' });
    } catch { warn(job, 'Shell result could not be submitted.'); jobs.delete(job.id); }
  }
  function shutdown() {
    const active = [...helpers];
    for (const job of jobs.values()) requestStop(job);
    jobs.clear();
    return Promise.all(active.map(job => new Promise(resolve => {
      const timer = setTimeout(() => {
        warn(job, 'Shell supervision lost; command status and cleanup are unknown.');
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
      job.exited.then(() => { clearTimeout(timer); resolve(); });
    })));
  }
  pi.on('session_shutdown', shutdown);
  pi.on('session_start', shutdown);
  pi.on('message_end', ({ message }) => {
    if (message.role === 'toolResult' && message.toolName === 'watch_shell') {
      const job = jobs.get(message.details?.process_id);
      if (!job || job.callId !== message.toolCallId || message.isError || message.details.status !== 'running') return;
      job.committed = true;
      // The receipt is in agent state at this public hook. Native followUp
      // queues behind the current turn; this is not a durable-save ACK.
      publish(job);
    } else if (message.role === 'custom' && message.customType === 'wakeups' && message.details?.kind === 'shell_exit') {
      const job = jobs.get(message.details.process_id);
      if (job?.submitted) jobs.delete(job.id);
    }
  });
  pi.registerTool({
    ...definition, label: 'watch shell', executionMode: 'sequential', exposure: 'model-only',
    async execute(callId, args, signal, _update, ctx) {
      const owner = lifecycle.readOwner(), incarnation = lifecycle.getIncarnation();
      if (!owner || !incarnation || !lifecycle.isCurrent(owner, incarnation)) throw new Error('WAKEUPS_OWNERSHIP_REQUIRED');
      if (ctx.mode !== 'tui' && ctx.mode !== 'rpc') throw new Error('WAKEUPS_PERSISTENT_MODE_REQUIRED');
      if (typeof args.command !== 'string' || !args.command.length || args.command.length > 4000 ||
          typeof args.on_exit !== 'string' || !args.on_exit.length || args.on_exit.length > 2000) throw new Error('WAKEUPS_INVALID_ARGUMENT');
      if (process.platform === 'win32') throw new Error('LAUNCH_FAILED');
      if (jobs.size >= MAX_PROCESSES || helpers.size >= MAX_PROCESSES) throw new Error('WAKEUPS_CAPACITY_REACHED');
      const job = { id: randomUUID(), callId, owner, incarnation, ctx, onExit: args.on_exit };
      jobs.set(job.id, job); // Reserve before asynchronous configuration or fork.
      try {
        const config = await getShellConfig();
        if (!current(job) || signal?.aborted || typeof config?.shell !== 'string' || !config.shell ||
            !Array.isArray(config.args) || !config.args.every(arg => typeof arg === 'string') ||
            (config.commandTransport && config.commandTransport !== 'argv')) throw new Error('LAUNCH_FAILED');
        const helper = fork(new URL('./shell-helper.mjs', import.meta.url), [], {
          detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [],
          env: { ...process.env, NODE_OPTIONS: undefined },
        });
        job.helper = helper;
        helpers.add(job);
        helper.unref();
        let exitResolve;
        job.exited = new Promise(resolve => { exitResolve = resolve; });
        const launched = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { requestStop(job); reject(new Error('LAUNCH_FAILED')); }, LAUNCH_TIMEOUT_MS);
          const fail = () => { clearTimeout(timer); reject(new Error('LAUNCH_FAILED')); };
          const finish = () => {
            if (job.helperFinished) return;
            job.helperFinished = true;
            clearTimeout(timer);
            clearInterval(job.monitor);
            helpers.delete(job);
            exitResolve();
            if (!job.pending && !job.cancelled) {
              if (job.launched) warn(job, 'Shell supervision lost; command status and cleanup are unknown.');
              jobs.delete(job.id);
            }
            fail();
          };
          // Failed fork emits error/close without exit. Only a missing PID
          // proves this error cannot belong to a live helper's IPC operation.
          helper.on('error', () => { if (helper.pid === undefined) finish(); else fail(); });
          helper.once('exit', finish);
          helper.once('close', finish);
          helper.on('message', message => {
            if (message?.type === 'ready') {
              if (!current(job) || signal?.aborted) { requestStop(job); fail(); return; }
              helper.send({ type: 'launch', shell: config.shell, args: config.args, command: args.command,
                cwd: ctx.cwd, nodeOptions: process.env.NODE_OPTIONS }, error => { if (error) fail(); });
            } else if (message?.type === 'launched') {
              job.launched = true;
              clearTimeout(timer);
              resolve();
            } else if (message?.type === 'launch_failed') fail();
            else if (message?.type === 'result') {
              const { type, ...payload } = message;
              job.pending = payload;
              clearInterval(job.monitor);
              publish(job);
            }
          });
        });
        job.monitor = setInterval(() => {
          if (!current(job)) { requestStop(job); jobs.delete(job.id); }
        }, OWNER_CHECK_MS);
        job.monitor.unref();
        await launched;
        helper.channel?.unref();
        if (!current(job) || signal?.aborted) throw new Error('LAUNCH_FAILED');
        return result({ process_id: job.id, status: 'running' });
      } catch {
        requestStop(job);
        jobs.delete(job.id);
        throw new Error('LAUNCH_FAILED');
      }
    },
  });
  return { shutdown };
}

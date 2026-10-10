import type { ExtensionAPI, ExtensionContext, InputEvent } from '@earendil-works/pi-coding-agent';
import { fork, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const WARNING = 'OWNERSHIP PROTECTION FAILED — SESSION UNPROTECTED';
const key = Symbol.for('portable-pi.session-lifecycle');
export type SessionLifecycleAdmission =
  | { readonly managed: true; readonly status: 'owned'; readonly sessionFile: string; readonly generation: string }
  | { readonly managed: true; readonly status: 'pending' | 'conflict' | 'stopping' }
  | { readonly managed: true; readonly status: 'unprotected'; readonly reason: string; readonly diagnostic?: string };
export interface SessionLifecycleAdmissionRequest { respond: (admission: SessionLifecycleAdmission) => void }
type DeferredStartup = { sessionFile: string; generation: string; complete?: () => void; input?: { text: string; images?: InputEvent['images'] } };
type State = { terminalWarning?: string; freshCommand?: ReturnType<typeof setImmediate>; deferredStartup?: DeferredStartup; awaitingFresh?: boolean; switching?: { file: string; generation: string; shutdown: boolean }; file?: string; canonicalFile?: string; generation?: string; child?: ChildProcess; mode: 'pending' | 'owned' | 'conflict' | 'stopping' | 'failed' | 'stateless'; diagnostic?: string; failure?: string; investigated?: boolean; onMessage?: (message: any) => Promise<void> };
const globals = globalThis as typeof globalThis & { [key]?: State };

const INIT_DEADLINE_MS = 2000;
// Includes the helper's five-second managed-worker contention wait.
const WORKER_INIT_DEADLINE_MS = 7000;
const RELEASE_DEADLINE_MS = 500;
function waitForExit(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const exit = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off('exit', exit); resolve(false); }, RELEASE_DEADLINE_MS);
    child.once('exit', exit);
  });
}
async function release(state: State) {
  const child = state.child;
  state.child = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  if (child.connected) child.send({ type: 'release' }, () => {});
  if (await exited) return;
  // This is our unreaped direct child, not an arbitrary PID from metadata.
  child.kill('SIGKILL');
  const verifiedExit = await waitForExit(child);
  throw Object.assign(new Error(), { code: verifiedExit ? 'GUARD_RELEASE_TIMEOUT' : 'GUARD_HELPER_EXIT_UNVERIFIED' });
}

const exec = promisify(execFile);

export default function sessionLifecycle(pi: ExtensionAPI) {
  // Transient launch association, inherited unchanged by nested workers.
  const workerOwner = process.env.PI_LIFECYCLE_OWNER;
  const state = globals[key] ??= { mode: 'pending' };
  function admission(): SessionLifecycleAdmission {
    if (state.mode === 'stateless') return Object.freeze({ managed: true, status: 'unprotected', reason: 'STATELESS_SESSION' });
    if (state.mode === 'owned' && state.canonicalFile && state.generation) return Object.freeze({ managed: true, status: 'owned', sessionFile: state.canonicalFile, generation: state.generation });
    if (state.mode === 'failed') return Object.freeze({ managed: true, status: 'unprotected', reason: state.failure ?? 'OWNERSHIP_UNVERIFIED', diagnostic: state.diagnostic });
    return Object.freeze({ managed: true, status: state.mode === 'owned' ? 'pending' : state.mode });
  }
  pi.events.on('session-lifecycle:admission', data => {
    const request = data as Partial<SessionLifecycleAdmissionRequest> | undefined;
    if (typeof request?.respond === 'function') request.respond(admission());
  });
  function sameFile(file?: string) {
    if (!file) return false;
    if (file === state.file) return true;
    try { return realpathSync(file) === state.canonicalFile; } catch { return false; }
  }
  const blocked = () => state.mode === 'pending' || state.mode === 'conflict' || state.mode === 'stopping';
  function cancelFreshCommand() {
    if (state.freshCommand) clearImmediate(state.freshCommand);
    state.freshCommand = undefined;
  }
  function queueFreshCommand() {
    cancelFreshCommand();
    const generation = state.generation;
    state.freshCommand = setImmediate(() => {
      state.freshCommand = undefined;
      if (globals[key] !== state || state.mode !== 'pending' || !state.awaitingFresh || state.switching || state.generation !== generation) return;
      // Dispatch only after startup handlers and the supplied initial input can
      // run against the original runtime. deliverAs alone does not defer commands.
      pi.sendUserMessage('/lifecycle-fresh-owner', { deliverAs: 'followUp', expandPromptTemplates: true });
    });
  }
  function discardStartup() {
    cancelFreshCommand();
    const deferred = state.deferredStartup;
    state.deferredStartup = undefined;
    deferred?.complete?.();
  }
  function warning(ctx: ExtensionContext) {
    if (!ctx.hasUI) { console.error(WARNING, state.diagnostic ?? state.failure); return; }
    ctx.ui.setWidget('session-lifecycle', [WARNING, state.diagnostic ?? state.failure ?? 'Diagnostic unavailable']);
    ctx.ui.setStatus('session-lifecycle', WARNING);
  }
  function terminalStatus(ctx: ExtensionContext, recovered = false) {
    if (!ctx.hasUI) {
      if (state.terminalWarning) console.error(state.terminalWarning);
      else if (recovered) console.error('Terminal monitoring recovered.');
      return;
    }
    ctx.ui.setWidget('session-terminal-monitor', state.terminalWarning ? [state.terminalWarning] : undefined);
    ctx.ui.setStatus('session-terminal-monitor', state.terminalWarning);
  }
  function investigate(ctx: ExtensionContext) {
    if (ctx.mode !== 'tui' || state.investigated) return;
    const runtime = state.onMessage;
    // Let the supplied startup input enter first; followUp then queues safely.
    setImmediate(() => {
      if (globals[key] !== state || state.onMessage !== runtime || state.mode !== 'failed' || state.investigated) return;
      state.investigated = true;
      pi.sendUserMessage(`Investigate ownership protection failure. This session is unprotected. Read the private diagnostic file ${state.diagnostic ?? '(unavailable; diagnostic write failed)'}. Do not restart or signal existing runtimes without user approval.`, { deliverAs: 'followUp' });
    });
  }
  async function fail(ctx: ExtensionContext, error: any, agentDir: string, inject = true) {
    discardStartup();
    state.mode = 'failed';
    if (state.terminalWarning) { state.terminalWarning = undefined; terminalStatus(ctx); }
    // Deliberately omit error.message, environment, prompts, and session contents.
    const safe = {
      code: /^[A-Z_]{2,40}$/.test(error.code ?? '') ? error.code : 'GUARD_INIT',
      name: ['Error', 'TypeError', 'RangeError'].includes(error.name) ? error.name : 'Error',
      // Preserve only our source location, never raw stack text or function names.
      stack: String(error.stack ?? '').split('\n').flatMap((line: string) => {
        const frame = line.match(/\/(session-lifecycle\.ts|supervisor\.mjs|lease\.mjs):(\d+):(\d+)\)?$/);
        return frame ? [`${frame[1]}:${frame[2]}:${frame[3]}`] : [];
      }),
      sqlite: Number.isInteger(error.sqlite) ? error.sqlite : undefined,
      reason: error.code === 'OWNER_METADATA_UNVERIFIABLE'
        ? 'The kernel lock was free at acquisition, but existing owner metadata is missing or invalid. Exclusive ownership was not granted; the evidence was left unchanged.'
        : error.code === 'SUPERVISOR_EXIT'
          ? 'The ownership supervisor exited before protection could be established or retained.'
          : error.code === 'GUARD_INIT_TIMEOUT' || error.code === 'GUARD_RELEASE_TIMEOUT' || error.code === 'GUARD_HELPER_EXIT_UNVERIFIED'
            ? 'The ownership helper did not complete an IPC handshake within its deadline. Protection could not be confirmed.'
            : 'Ownership protection could not initialize or retain its supervisor. Check the safe error code and source locations below.',
      nextSteps: error.code === 'OWNER_METADATA_UNVERIFIABLE'
        ? 'Inspect the retained .pi-lifecycle sidecar directory beside the canonical session file and verify prior runtime identities before recovery. Do not delete or replace lock files, rewrite unknown metadata, or signal recorded PIDs based on this failure.'
        : 'Check the helper files, session-directory permissions and runtime node:sqlite capability. Preserve ownership evidence. Do not delete lock files or signal recorded PIDs without verified ownership.',
      context: { operation: 'session ownership protection', sessionFile: state.file, agentStateDirectory: agentDir },
    };
    state.failure = safe.code;
    try {
      const directory = join(agentDir, 'lifecycle-diagnostics');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      state.diagnostic = join(directory, `${randomUUID()}.json`);
      await writeFile(state.diagnostic, JSON.stringify(safe, null, 2), { mode: 0o600 });
    } catch { state.failure = `${safe.code}: diagnostic file could not be written`; }
    warning(ctx);
    if (inject) investigate(ctx);
  }
  pi.registerCommand?.('lifecycle-fresh-owner', {
    description: 'Finish pending ownership by reloading the saved session',
    handler: async (_args, ctx) => {
      if (state.mode !== 'pending' || !state.awaitingFresh || state.switching || !state.file || !state.canonicalFile || !state.generation || !state.child?.connected) return;
      const deferred = state.deferredStartup;
      state.switching = { file: state.canonicalFile, generation: state.generation, shutdown: false };
      try {
        await ctx.switchSession(state.file, { withSession: async fresh => {
          if (state.mode !== 'owned' || !deferred?.input || deferred !== state.deferredStartup ||
            deferred.sessionFile !== state.canonicalFile || deferred.generation !== state.generation || !sameFile(fresh.sessionManager.getSessionFile())) return;
          // Consume before dispatch. Never replay through an invalidated pi/ctx,
          // and never retry a task after cancellation or a failed send.
          const input = deferred.input;
          state.deferredStartup = undefined;
          deferred.input = undefined;
          try {
            await fresh.sendUserMessage([{ type: 'text', text: input.text }, ...(input.images ?? [])], { deliverAs: 'followUp', expandPromptTemplates: false });
          } catch { fresh.ui.notify('Deferred startup task could not be delivered. Submit it again if needed.', 'error'); }
        } });
      } catch { ctx.ui.notify('Fresh session reload failed. Retry /lifecycle-fresh-owner if admission is still pending, or quit.', 'error'); }
      finally {
        state.switching = undefined;
        if (state.deferredStartup === deferred) state.deferredStartup = undefined;
        deferred?.complete?.();
      }
    },
  });
  pi.on('session_start', async (event, ctx) => {
    const file = ctx.sessionManager.getSessionFile();
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
    state.onMessage = async message => {
      if (message.type === 'terminal-monitor' && (state.mode === 'owned' || (state.mode === 'pending' && state.awaitingFresh)) &&
        message.sessionFile === state.canonicalFile && message.generation === state.generation && typeof message.available === 'boolean') {
        const code = ['TMUX_QUERY_TIMEOUT', 'TMUX_QUERY_FAILED', 'TMUX_CLIENT_COUNT_INVALID'].includes(message.code) ? message.code : 'TMUX_QUERY_FAILED';
        state.terminalWarning = message.available ? undefined : `Terminal monitoring unavailable (${code}). Writer lease retained; retrying automatically.`;
        terminalStatus(ctx, message.available);
      }
      if (message.type === 'stop') { discardStartup(); state.mode = 'stopping'; ctx.abort(); ctx.shutdown(); }
      if (message.type === 'failure' && state.mode !== 'failed') {
        if (workerOwner !== undefined) { discardStartup(); state.mode = 'stopping'; ctx.abort(); ctx.shutdown(); }
        else await fail(ctx, message, agentDir);
      }
    };
    if (state.mode === 'stopping') return;
    if (sameFile(file) && (state.mode === 'owned' || (state.mode === 'pending' && state.awaitingFresh))) {
      const attempt = state.switching;
      // CLI replacement installs fresh history before dispatching session_start.
      // Admit here, before later consumers; withSession runs after all of them.
      if (state.mode === 'pending' && state.awaitingFresh && attempt?.shutdown &&
        event.reason === 'resume' && sameFile(event.previousSessionFile) &&
        attempt.file === state.canonicalFile && attempt.generation === state.generation && state.child?.connected) {
        state.awaitingFresh = false;
        state.mode = 'owned';
      }
      state.file = file;
      if (state.terminalWarning) terminalStatus(ctx);
      if (state.awaitingFresh && !state.switching) queueFreshCommand();
      return;
    }
    if (state.mode === 'failed') { warning(ctx); investigate(ctx); return; }
    state.file = file;
    state.mode = 'pending';
    if (state.terminalWarning) { state.terminalWarning = undefined; terminalStatus(ctx); }
    try {
      if (state.child) await release(state);
      if (!file && workerOwner === undefined) {
        // Intentional in-memory CLI session: no shared saved file to protect.
        // Keep an explicit managed response so consumers cannot fall back to
        // legacy ownership-dependent work, but do not inject an error turn.
        state.mode = 'stateless';
        state.canonicalFile = undefined;
        state.generation = undefined;
        return;
      }
      // Keep support-module failures inside the established diagnostic path.
      const { ownerRequest } = await import('../lifecycle/owner-client.mjs');
      let unownedHelper: ChildProcess | undefined;
      async function claim(): Promise<any> {
        const owningRoot = workerOwner === undefined ? undefined : JSON.parse(workerOwner);
        const reusable = unownedHelper === state.child && unownedHelper?.connected && unownedHelper.exitCode === null && unownedHelper.signalCode === null ? unownedHelper : undefined;
        unownedHelper = undefined; // A failed/uncertain handshake never authorizes reuse.
        if (!reusable && state.child) await release(state);
        const child = reusable ?? fork(new URL('../lifecycle/supervisor.mjs', import.meta.url), [], {
          detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [],
        });
        state.child = child;
        const result: any = await new Promise((resolve, reject) => {
          const message = (value: any) => finish(undefined, value);
          const error = (value: any) => finish(value);
          const exit = () => finish(Object.assign(new Error(), { code: 'SUPERVISOR_EXIT' }));
          const timer = setTimeout(() => finish(Object.assign(new Error(), { code: 'GUARD_INIT_TIMEOUT' })), workerOwner === undefined ? INIT_DEADLINE_MS : WORKER_INIT_DEADLINE_MS);
          function finish(problem?: any, value?: any) {
            clearTimeout(timer);
            child.off('message', message); child.off('error', error); child.off('exit', exit);
            problem ? reject(problem) : resolve(value);
          }
          child.once('message', message); child.once('error', error); child.once('exit', exit);
          child.send({ type: 'claim', file, pid: process.pid,
            owningRoot,
            terminal: process.env.TMUX && process.env.TMUX_PANE ? { socket: process.env.TMUX.split(',')[0], pane: process.env.TMUX_PANE } : undefined,
          }, problem => { if (problem) finish(problem); });
        });
        if (result.type === 'conflict') unownedHelper = child;
        return result;
      }
      let result = await claim();
      if (result.type === 'stop' || (workerOwner !== undefined && result.type === 'failure')) {
        state.mode = 'stopping';
        if (ctx.hasUI) ctx.ui.notify('Worker owner or protection could not be verified. Stopping this worker.', 'warning');
        ctx.shutdown();
        return;
      }
      if (workerOwner !== undefined && result.type === 'conflict') {
        // Unattended workers cannot answer a takeover dialog. Keep admission
        // closed after the bounded wait and let the launcher report/retry later.
        state.mode = 'stopping';
        if (ctx.hasUI) ctx.ui.notify('Worker session is still owned after waiting for retirement. No work was admitted; retry after the previous worker stops.', 'warning');
        // Keep the helper until exit so idle RPC or hung workers are enforced.
        ctx.shutdown();
        return;
      }
      let continued = false;
      while (result.type === 'conflict') {
        state.mode = 'conflict';
        if (!ctx.hasUI) { await release(state); state.mode = 'stopping'; ctx.shutdown(); return; }
        const location = result.owner?.location;
        const where = location ? `tmux ${location.socket} pane ${location.pane}` : 'location unavailable';
        const choice = await ctx.ui.select(`Session already owned (${where})`, ['Continue here', 'Go to existing session', 'Cancel']);
        if (!choice || choice === 'Cancel') { state.mode = 'stopping'; await release(state); ctx.shutdown(); return; }
        try {
          if (choice === 'Go to existing session') {
            // Unsupported navigation is deliberately not a reason to exit.
            if (!location || !process.env.TMUX || process.env.TMUX.split(',')[0] !== location.socket || !process.env.TMUX_PANE) throw new Error('Unsupported terminal navigation');
            await ownerRequest(result.owner, result.sessionFile, 'probe', 1000);
            const tmux = async (...args: string[]) => (await exec('tmux', ['-S', location.socket, ...args], { timeout: 1000 })).stdout.trim();
            const format = '#{client_name}\t#{pane_id}\t#{client_control_mode}';
            const rows = (await tmux('list-clients', '-F', format)).split('\n');
            const clients = rows.map(row => row.split('\t')).filter(row => row[1] === process.env.TMUX_PANE);
            if (clients.length !== 1) throw new Error('Exact originating client unavailable');
            if (clients[0][2] !== '0') throw Object.assign(new Error(), { code: 'NAVIGATION_UNSUPPORTED' });
            await tmux('switch-client', '-c', clients[0][0], '-t', location.pane);
            const observed = (await tmux('list-clients', '-F', format)).split('\n');
            if (!observed.includes(`${clients[0][0]}\t${location.pane}\t0`)) throw new Error('Target pane not observed in an ordinary client');
            await ownerRequest(result.owner, result.sessionFile, 'probe', 1000);
            state.mode = 'stopping'; await release(state); ctx.shutdown(); return;
          }
          await ownerRequest(result.owner, result.sessionFile, 'stop', 1000);
          const generation = result.owner.generation;
          const deadline = Date.now() + 4000;
          do {
            await new Promise(resolve => setTimeout(resolve, 50));
            result = await claim();
            if (result.type !== 'conflict' || (result.owner && result.owner.generation !== generation)) break;
          } while (Date.now() < deadline);
          if (result.type === 'owned') { continued = true; break; }
          if (result.type !== 'conflict') {
            // A failed retirement attempt must never open unprotected chat.
            throw new Error('Replacement ownership could not be verified');
          }
          ctx.ui.notify('Previous owner has not retired or ownership changed. Admission remains blocked.', 'warning');
        } catch (error: any) {
          ctx.ui.notify(error.code === 'NAVIGATION_UNSUPPORTED'
            ? `Control-mode/native GUI focus is unsupported (${where}). Choose Cancel or visit that location manually; this session remains blocked.`
            : `Cannot verify or reach the existing owner (${where}). Keep this session blocked; inspect that location or quit. No recorded PID was signalled.`, 'warning');
          if (result.type !== 'conflict') { await release(state); state.mode = 'stopping'; ctx.shutdown(); return; }
        }
      }
      const child = state.child!;
      if (result.type === 'failure') { await release(state); await fail(ctx, result, agentDir); return; }
      if (result.type === 'owned') {
        if (typeof result.sessionFile !== 'string' || !result.sessionFile || typeof result.generation !== 'string' || !result.generation) throw Object.assign(new Error(), { code: 'GUARD_PROTOCOL_INVALID' });
        state.canonicalFile = result.sessionFile;
        state.generation = result.generation;
        state.awaitingFresh = continued || result.recovered === true;
        state.mode = state.awaitingFresh ? 'pending' : 'owned';
        state.deferredStartup = state.awaitingFresh && event.reason === 'startup'
          ? { sessionFile: result.sessionFile, generation: result.generation } : undefined;
        child.on('message', message => { void state.onMessage?.(message); });
        child.on('exit', () => {
          if (state.child === child && (state.mode === 'owned' || state.awaitingFresh)) void state.onMessage?.({ type: 'failure', code: 'SUPERVISOR_EXIT' });
        });
        child.unref();
        child.channel?.unref();
        if (state.awaitingFresh) queueFreshCommand();
        return;
      }
      // A lease, even with unknown metadata, never enters the fail-open path.
      state.mode = 'conflict';
      if (ctx.hasUI) await ctx.ui.select('Ownership response could not be verified.', ['Cancel']);
      state.mode = 'stopping';
      await release(state);
      ctx.shutdown();
    } catch (error) {
      if (workerOwner !== undefined) {
        discardStartup();
        state.mode = 'stopping';
        try { await release(state); } catch { /* Never grant unprotected worker admission. */ }
        if (ctx.hasUI) ctx.ui.notify('Worker owner or protection could not be verified. Stopping this worker.', 'warning');
        ctx.shutdown();
        return;
      }
      if (state.mode === 'conflict' || state.mode === 'stopping') { state.mode = 'stopping'; ctx.shutdown(); return; }
      try { await release(state); } catch (releaseError) { error = releaseError; }
      await fail(ctx, error, agentDir);
    }
  });
  pi.on('input', async (event, ctx) => {
    if (!blocked()) return;
    const deferred = state.deferredStartup;
    // Only the first supplied CLI input in the post-acquisition initial fresh-
    // reload gate is eligible. Conflict input and extension messages are not.
    if (state.mode === 'pending' && state.awaitingFresh && deferred && !deferred.input &&
      event.source === 'interactive' && sameFile(ctx.sessionManager.getSessionFile()) &&
      deferred.sessionFile === state.canonicalFile && deferred.generation === state.generation) {
      deferred.input = { text: event.text, images: event.images?.map(image => ({ ...image })) };
      // Keep the initial CLI prompt alive until its fresh-context dispatch (or
      // cancellation) completes; print mode otherwise shuts down mid-switch.
      await new Promise<void>(resolve => { deferred.complete = resolve; });
    }
    return { action: 'handled' };
  });
  pi.on('tool_call', async () => blocked() ? { block: true, reason: 'Session ownership unresolved' } : undefined);
  pi.on('user_bash', async () => {
    if (blocked()) return { result: { output: 'Session ownership unresolved', exitCode: 1, cancelled: false, truncated: false } };
  });
  pi.on('session_before_switch', async (event) => state.switching && event.reason === 'resume' && sameFile(event.targetSessionFile) ? undefined : blocked() ? { cancel: true } : undefined);
  pi.on('session_shutdown', async (event, ctx) => {
    cancelFreshCommand();
    if (state.mode === 'pending' && state.awaitingFresh && state.switching && event.reason === 'resume' && sameFile(event.targetSessionFile)) state.switching.shutdown = true;
    if (event.reason === 'reload' || (event.reason === 'resume' && sameFile(event.targetSessionFile))) return;
    // Stop ordinary and package admission before ownership release or exit.
    discardStartup();
    state.mode = 'stopping';
    // Keep the lease until process exit on quit, not merely shutdown request.
    if (event.reason !== 'quit') {
      try { await release(state); }
      catch (error) {
        const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
        // Session replacement invalidates this runtime. Inject only from the
        // fresh session_start callback, never while tearing the old one down.
        await fail(ctx, error, agentDir, false);
        return;
      }
    }
    delete globals[key];
    // Keep this runtime's responder stopping until Pi invalidates its event-bus
    // subscriptions. A replacement factory gets a new pending state.
  });
}

// A separate process holds the lease. No process-name or process-group signals.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';

const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let lease;
const send = value => { if (process.connected) process.send(value, () => {}); };
const failure = error => send({ type: 'failure', code: error.code ?? 'SUPERVISOR_QUERY', sqlite: error.errcode, name: error.name, stack: error.stack?.split('\n').slice(1).join('\n') });
async function identity(pid, timeout = 1000) {
  return (await exec('ps', ['-p', String(pid), '-o', 'lstart='], { timeout })).stdout.trim();
}
let stopping = false;
let endpoint;
async function stopRoot(pid, started, reason, identityTimeout = 1000) {
  if (stopping || closing) return;
  stopping = true;
  send({ type: 'stop', reason });
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    await pause(750);
    // Only this helper's still-connected direct parent can be signalled.
    if (closing || !process.connected) return;
    if (await identity(pid, identityTimeout) !== started) throw Object.assign(new Error(), { code: 'ROOT_IDENTITY_CHANGED' });
    if (closing || !process.connected) return;
    process.kill(pid, signal);
  }
}
async function listenOwner(pid, started) {
  endpoint = createServer({ allowHalfOpen: true }, socket => {
    socket.setTimeout(1000, () => socket.destroy());
    let text = '';
    socket.on('error', () => {});
    socket.on('data', data => {
      text += data;
      if (text.length > 8192) { socket.destroy(); return; }
      if (!text.includes('\n')) return;
      socket.pause();
      void (async () => {
        try {
          const request = JSON.parse(text);
          if (closing || !process.connected || !lease ||
            request.file !== lease.sessionFile || request.generation !== lease.generation ||
            !['probe', 'stop'].includes(request.action) || await identity(pid) !== started) {
            socket.end(JSON.stringify({ type: 'refused' })); return;
          }
          lease.assertOwned();
          socket.end(JSON.stringify({ type: 'owner', file: lease.sessionFile, generation: lease.generation, pid, started }));
          if (request.action === 'stop') void stopRoot(pid, started, 'Continue here requested').catch(failure);
        } catch { socket.end(JSON.stringify({ type: 'refused' })); }
      })();
    });
  });
  await new Promise((resolve, reject) => {
    endpoint.once('error', reject);
    endpoint.listen(0, '127.0.0.1', resolve);
  });
  return endpoint.address().port;
}
async function monitor(pid, terminal, started) {
  const tmux = async (...args) => (await exec('tmux', ['-S', terminal.socket, ...args], { timeout: 1000 })).stdout.trim().split('\n');
  try {
    while (!closing) {
      // Enumerate all sessions containing this pane, including linked windows.
      // A client viewing another window in a relevant session still owns it.
      const panes = await tmux('list-panes', '-a', '-F', '#{pane_id}\t#{session_attached}');
      const counts = panes.filter(row => row.split('\t')[0] === terminal.pane).map(row => {
        const count = row.split('\t')[1];
        if (!/^\d+$/.test(count ?? '') || !Number.isSafeInteger(Number(count))) {
          throw Object.assign(new Error(), { code: 'TMUX_CLIENT_COUNT_INVALID' });
        }
        return Number(count);
      });
      if (!counts.some(count => count > 0)) {
        await stopRoot(pid, started, 'last relevant terminal client detached');
        return;
      }
      await pause(250);
    }
  } catch (error) { if (!closing) failure(error); }
}

async function verifyOwningRoot(module, root) {
  if (!Number.isSafeInteger(root?.pid) || root.pid <= 1 || typeof root.started !== 'string' || !root.started ||
    typeof root.sessionFile !== 'string' || !root.sessionFile || typeof root.generation !== 'string' || !root.generation) throw new Error('Invalid owning root');
  const evidence = module.inspectOwner(root.sessionFile);
  const owner = evidence.owner;
  if (evidence.sessionFile !== root.sessionFile || owner?.status !== 'active' ||
    owner.pid !== root.pid || owner.started !== root.started || owner.generation !== root.generation ||
    !Number.isInteger(owner.port) || owner.port < 1 || owner.port > 65535) throw new Error('Original receipt changed');
  const { ownerRequest } = await import('./owner-client.mjs');
  // The owner helper checks its connected parent's fresh start identity and
  // held lease before replying. Match that exact response, not a cached PID.
  await ownerRequest(owner, root.sessionFile, 'probe', 500);
}
async function monitorOwningRoot(module, root, pid, started) {
  while (!closing && !stopping) {
    await pause(250);
    if (closing || stopping) return;
    try { await verifyOwningRoot(module, root); }
    catch {
      // Uncertain owner evidence stops only our connected direct worker parent.
      await stopRoot(pid, started, 'Original owning root unavailable or changed', 500).catch(failure);
      return;
    }
  }
}

let closing = false;
let queue = Promise.resolve();
function retire(rootExited) {
  if (closing) return;
  closing = true;
  endpoint?.close();
  // Serialize disconnect/release after an in-flight import/identity query.
  // Publication itself is synchronous, so no old write can finish after unlock.
  queue = queue.then(() => {
    try { lease?.release({ rootExited }); process.exit(0); }
    catch { process.exit(1); }
  });
}
process.on('disconnect', () => retire(true));
process.on('message', message => {
  if (message.type === 'release') { retire(false); return; }
  queue = queue.then(async () => {
    if (closing || message.type !== 'claim' || lease) return;
    let sqliteBusy, started;
    try {
      if (message.pid !== process.ppid) throw Object.assign(new Error(), { code: 'ROOT_NOT_PARENT' });
      started = await identity(message.pid);
      // Dynamic import makes a missing SQLite capability an initialization error.
      const module = await import('./lease.mjs');
      sqliteBusy = module.isSqliteBusy;
      if (closing) return;
      if (message.owningRoot !== undefined) {
        await verifyOwningRoot(module, message.owningRoot);
        if (closing) return;
        void monitorOwningRoot(module, message.owningRoot, message.pid, started);
        if (!message.file) {
          send({ type: 'owned', sessionFile: message.owningRoot.sessionFile, generation: message.owningRoot.generation });
          return;
        }
      }
      let result = module.acquireLease(message.file);
      if (message.owningRoot !== undefined && result.type === 'conflict') {
        // A resumed managed worker may arrive during its predecessor's allowed
        // stop window. Retry only lease contention, never infrastructure errors.
        const deadline = Date.now() + 5000;
        while (result.type === 'conflict' && Date.now() < deadline) {
          await pause(100);
          if (closing || stopping) return;
          result = module.acquireLease(message.file);
        }
      }
      if (result.type === 'conflict') {
        send(result);
        if (message.owningRoot !== undefined) await stopRoot(message.pid, started, 'Worker session still owned after retirement wait', 500);
        return;
      }
      lease = result.lease;
      const port = await listenOwner(message.pid, started);
      if (closing || stopping) return;
      lease.publish({ pid: message.pid, started, location: message.terminal, port });
      lease.assertOwned();
      send({ type: 'owned', generation: lease.generation, sessionFile: lease.sessionFile, recovered: result.recovered });
      if (message.terminal && message.owningRoot === undefined) void monitor(message.pid, message.terminal, started);
    } catch (error) {
      if (message.owningRoot !== undefined && started) {
        await stopRoot(message.pid, started, 'Original owning root or worker protection could not be verified', 500).catch(failure);
      } else if (sqliteBusy?.(error)) send({ type: 'conflict', reason: 'busy' });
      else if (error.code === 'OWNER_INITIALIZATION_CHANGED') send({ type: 'conflict', reason: 'recovery' });
      else failure(error);
    }
  });
});

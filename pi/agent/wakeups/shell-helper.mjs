// Private launcher, never import this module into the Pi process.
import { spawn, execFileSync } from 'node:child_process';

const STOP_GRACE_MS = 500;
const DRAIN_GRACE_MS = 200;
const TAIL_BYTES = 4096;
function tailBuffer() {
  let bytes = Buffer.alloc(0), total = 0;
  return {
    push(chunk) {
      total += chunk.length;
      const size = Math.min(TAIL_BYTES, bytes.length + chunk.length);
      const next = Buffer.allocUnsafeSlow(size);
      const fromChunk = Math.min(size, chunk.length);
      bytes.copy(next, 0, bytes.length - (size - fromChunk));
      chunk.copy(next, size - fromChunk, chunk.length - fromChunk);
      bytes = next;
    },
    finish() {
      let start = 0;
      // A byte suffix may start in the middle of a UTF-8 codepoint.
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
      let text = bytes.subarray(start).toString('utf8');
      // Invalid UTF-8 replacement characters can expand encoded text size.
      while (Buffer.byteLength(text) > TAIL_BYTES) text = bytes.subarray(++start).toString('utf8');
      return { text, dropped: total - bytes.length + start };
    },
  };
}
let isolated = false;
let stopping = false;
let child;
let launched = false;
let completed = false;

function send(message) {
  if (process.connected) process.send(message, error => { if (error) stop(); });
}
function stop() {
  if (stopping) return;
  stopping = true;
  if (!isolated) { process.exit(1); return; }
  // This live session leader pins the group. Never signal a cached group ID.
  // The helper survives TERM so even resistant descendants receive KILL.
  setTimeout(() => process.kill(0, 'SIGKILL'), STOP_GRACE_MS);
  process.kill(0, 'SIGTERM');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
process.on('message', message => {
  if (message?.type === 'stop') { stop(); return; }
  if (message?.type !== 'launch' || stopping || launched || !isolated) return;
  launched = true;
  try {
    child = spawn(message.shell, [...message.args, message.command], {
      cwd: message.cwd, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: message.nodeOptions },
    });
    const stdout = tailBuffer(), stderr = tailBuffer();
    let termination, drainTimer;
    let ended = 0;
    let streamError = false;
    function finish(incomplete) {
      if (completed || !termination) return;
      completed = true;
      clearTimeout(drainTimer);
      const out = stdout.finish(), err = stderr.finish();
      send({ type: 'result', termination, stdout_tail: out.text, stderr_tail: err.text,
        stdout_dropped_bytes: out.dropped, stderr_dropped_bytes: err.dropped,
        output_incomplete: incomplete || streamError });
      child.stdout.destroy();
      child.stderr.destroy();
      stop();
    }
    for (const [stream, tail] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on('data', chunk => tail.push(chunk));
      stream.once('end', () => { ended++; if (ended === 2) finish(false); });
      stream.on('error', () => { streamError = true; });
    }
    child.once('spawn', () => send({ type: 'launched' }));
    child.once('error', () => { send({ type: 'launch_failed' }); stop(); });
    child.once('exit', (code, signal) => {
      termination = Number.isInteger(code) ? { exit_code: code } : { signal };
      if (ended === 2) finish(false);
      else drainTimer = setTimeout(() => finish(true), DRAIN_GRACE_MS);
    });
  } catch { send({ type: 'launch_failed' }); stop(); }
});

try {
  // Fail closed if accidentally invoked without detached:true. No group signals
  // before this check; no shell is launched before the parent's admission recheck.
  const group = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)],
    { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 }).trim());
  isolated = group === process.pid && process.connected === true && process.platform !== 'win32';
  if (!isolated) process.exit(1);
  send({ type: 'ready' });
} catch { process.exit(1); }

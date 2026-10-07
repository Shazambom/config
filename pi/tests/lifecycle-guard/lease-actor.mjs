// Private multiprocess fixture: command boundaries pause callbacks, not timeouts.
import { acquireLease } from '../../agent/lifecycle/lease.mjs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
const started = execFileSync('ps', ['-p', String(process.ppid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
let lease, paused, raw;
const owner = incarnation => ({ pid: process.ppid, started, incarnation });
process.on('message', message => {
  try {
    if (message.type === 'provision') {
      writeFileSync(message.database, '', { flag: 'wx', mode: 0o600 }); process.send({ type: 'provisioned' });
    } else if (message.type === 'open') {
      const result = acquireLease(message.file);
      lease = result.lease;
      process.send({ type: result.type, owner: result.owner, reason: result.reason, database: lease?.database, metadata: lease?.metadata });
    } else if (message.type === 'prepare') {
      lease.prepare(owner(message.incarnation)); process.send({ type: 'prepared' });
    } else if (message.type === 'commit-initialization') {
      lease.commitInitialization(); process.send({ type: 'committed' });
    } else if (message.type === 'reacquire') {
      lease.reacquire(); process.send({ type: 'reacquired' });
    } else if (message.type === 'ack') {
      lease.assertOwned(); process.send({ type: 'ack' });
    } else if (message.type === 'hold-kernel') {
      raw = new DatabaseSync(message.database); raw.exec('BEGIN IMMEDIATE'); process.send({ type: 'holding' });
    } else if (message.type === 'publish') {
      lease.publish(owner(message.incarnation));
      process.send({ type: 'published' });
    } else if (message.type === 'pause-callback') {
      paused = () => { lease.publish({ pid: process.ppid, started, incarnation: 'stale' }); lease.release(); };
      process.send({ type: 'paused' });
    } else if (message.type === 'resume-callback') {
      paused(); process.send({ type: 'resumed' });
    } else if (message.type === 'release') {
      lease?.release(); raw?.close(); raw = undefined; process.send({ type: 'released' });
    } else if (message.type === 'exit') {
      lease?.release(); process.exit(0);
    }
  } catch (error) { process.send({ type: 'error', code: error.code, sqlite: error.errcode }); }
});

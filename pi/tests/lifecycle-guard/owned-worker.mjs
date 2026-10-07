import { fork } from 'node:child_process';
const helper = fork(new URL('../../agent/lifecycle/supervisor.mjs', import.meta.url), [], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
let hang = false;
helper.on('message', message => {
  process.send?.({ ...message, helperPid: helper.pid });
  if (message.type === 'stop' && !hang) process.exit(0);
  if (message.type === 'owned' && hang) {
    process.on('SIGTERM', () => {});
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
});
process.on('message', message => { hang = message.hang; helper.send({ type: 'claim', pid: process.pid, file: message.file, owningRoot: message.owningRoot }); });
process.on('disconnect', () => process.exit(0));

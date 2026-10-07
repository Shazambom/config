import { fork } from 'node:child_process';
const helper = fork(new URL('../../agent/lifecycle/supervisor.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
helper.on('message', message => {
  if (process.connected) process.send(message);
  if (message.type === 'stop') process.exit(0);
});
process.on('message', message => helper.send({ ...message, pid: process.pid }));
process.on('disconnect', () => {
  if (!helper.connected) { process.exit(0); return; }
  helper.once('exit', () => process.exit(0));
  helper.send({ type: 'release' });
});

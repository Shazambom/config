import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const supervisor = fileURLToPath(new URL('../../agent/lifecycle/supervisor.mjs', import.meta.url));

// The supervisor may signal only this disposable root, never the test runner.
const rootSource = `
import { fork } from 'node:child_process';
const child = fork(process.argv[2], [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
let timer, finished = false;
function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  process.send(result);
  child.send({ type: 'release' }, () => {});
}
child.on('message', message => {
  if (message.type === 'owned') timer = setTimeout(() => finish({ type: 'alive' }), Number(process.env.MONITOR_ALIVE_MS ?? 400));
  else finish(message);
});
child.on('exit', () => process.exit(finished ? 0 : 2));
child.send({ type: 'claim', file: process.argv[3], pid: process.pid,
  terminal: { socket: 'private-fixture', pane: '%1' } });
setTimeout(() => { child.kill('SIGKILL'); process.exitCode = 2; }, 5000).unref();
`;

for (const [name, output, commandExit, expected] of [
  ['linked session still attached', '%1\t0\n%1\t2\n%2\t1\n', 0, 'alive'],
  ['only unrelated session attached', '%1\t0\n%2\t1\n', 0, 'stop'],
  ['valid complete enumeration confirms target pane is gone', '%2\t1\n', 0, 'stop'],
  ['malformed attached count', '%1\tunknown\n', 0, 'terminal-monitor'],
  ['empty reply is not confirmed terminal loss', '', 0, 'terminal-monitor'],
  ['malformed unrelated row is uncertain', 'unexpected output\n', 0, 'terminal-monitor'],
  ['query failed', '', 7, 'terminal-monitor'],
]) {
  test(name, { timeout: 10000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-monitor-'));
    await mkdir(join(root, 'bin'));
    await writeFile(join(root, 'root.mjs'), rootSource);
    await writeFile(join(root, 'output'), output);
    await writeFile(join(root, 'bin/tmux'), `#!/bin/sh\ncat "$MONITOR_OUTPUT"\nexit ${commandExit}\n`, { mode: 0o700 });
    const child = fork(join(root, 'root.mjs'), [supervisor, join(root, 'session.jsonl')], {
      cwd: root,
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, MONITOR_OUTPUT: join(root, 'output'), MONITOR_ALIVE_MS: expected === 'alive' ? '400' : '4000' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const messages = [];
    let errors = '';
    child.on('message', message => messages.push(message));
    child.stderr.on('data', data => { errors += data; });
    const outcome = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(outcome, { code: 0, signal: null }, errors);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, expected);
    if (expected === 'terminal-monitor') {
      assert.equal(messages[0].available, false);
      assert.equal(messages[0].code, commandExit ? 'TMUX_QUERY_FAILED' : 'TMUX_CLIENT_COUNT_INVALID');
    }
    await writeFile(join(root, 'result.json'), JSON.stringify({ name, outcome, messages }));
    console.log(`Monitor proof: ${root}`);
  });
}

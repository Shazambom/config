import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { inspectOwner } from '../../agent/lifecycle/lease.mjs';
import { ownerRequest } from '../../agent/lifecycle/owner-client.mjs';

const supervisor = fileURLToPath(new URL('../../agent/lifecycle/supervisor.mjs', import.meta.url));
const rootSource = `
import { fork } from 'node:child_process';
const helper = fork(process.argv[2], [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
helper.on('message', message => process.send(message));
helper.on('exit', code => process.exit(code ?? 1));
process.on('message', message => { if (message.type === 'release') helper.send(message); });
helper.send({ type: 'claim', file: process.argv[3], pid: process.pid,
  terminal: { socket: 'private-fixture', pane: '%1' } });
`;
const tmuxSource = `#!/usr/bin/env node
const fs = require('node:fs');
const plan = JSON.parse(fs.readFileSync(process.env.MONITOR_PLAN, 'utf8'));
let attempt = 0;
try { attempt = Number(fs.readFileSync(process.env.MONITOR_COUNT, 'utf8')); } catch {}
fs.writeFileSync(process.env.MONITOR_COUNT, String(attempt + 1));
const action = plan[Math.min(attempt, plan.length - 1)];
if (action === 'timeout') {
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 25);
} else if (action === 'failed') {
  process.exit(7);
} else {
  console.log('%1\\t' + (action === 'detached' ? '0' : '1'));
}
`;

async function fixture(plan, run) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-monitor-retry-'));
  await mkdir(join(directory, 'bin'));
  await writeFile(join(directory, 'root.mjs'), rootSource);
  await writeFile(join(directory, 'bin/tmux'), tmuxSource, { mode: 0o700 });
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan));
  const file = join(directory, 'session.jsonl');
  const child = fork(join(directory, 'root.mjs'), [supervisor, file], {
    env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      MONITOR_PLAN: join(directory, 'plan.json'), MONITOR_COUNT: join(directory, 'count') },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const messages = [];
  let stderr = '';
  child.on('message', message => messages.push(message));
  child.stderr.on('data', data => { stderr += data; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const until = async predicate => {
    const deadline = Date.now() + 10000;
    while (!await predicate()) {
      if (Date.now() >= deadline) throw new Error(`Fixture deadline: ${JSON.stringify(messages)} ${stderr}`);
      await pause(20);
    }
  };
  const count = async () => Number(await readFile(join(directory, 'count'), 'utf8').catch(() => '0'));
  const probe = async () => {
    const evidence = inspectOwner(file);
    await ownerRequest(evidence.owner, evidence.sessionFile, 'probe', 1500);
  };
  try {
    await until(() => messages.some(message => message.type === 'owned' || message.type === 'failure'));
    assert.equal(messages[0].type, 'owned', stderr);
    await run({ child, messages, exited, until, count, probe });
  } finally {
    if (child.connected) child.send({ type: 'release' }, () => {});
    const deadline = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await exited; } finally { clearTimeout(deadline); }
    await writeFile(join(directory, 'result.json'), JSON.stringify({ messages, stderr }, null, 2));
    console.log(`Monitor retry proof: ${directory}`);
  }
}

test('transient query timeouts recover, retain ownership, reset the retry budget, and still stop after detach', { timeout: 20000 }, async () => {
  await fixture(['timeout', 'attached', 'timeout', 'attached', 'timeout', 'attached', 'detached'], async ({ messages, exited, until, count, probe }) => {
    await until(async () => await count() >= 3 || messages.some(message => message.type === 'failure'));
    assert(!messages.some(message => message.type === 'failure'), 'A single timeout must not permanently disable protection');
    await probe();
    await until(() => messages.some(message => ['stop', 'failure'].includes(message.type)));
    assert(!messages.some(message => message.type === 'failure'), 'Successful queries must reset the timeout budget');
    assert.equal(messages.find(message => message.type === 'stop')?.reason, 'last relevant terminal client detached');
    assert.equal((await exited).signal, 'SIGTERM', 'Only the disposable root must be stopped');
    assert.equal(await count(), 7);
  });
});

for (const [action, code] of [['timeout', 'TMUX_QUERY_TIMEOUT'], ['failed', 'TMUX_QUERY_FAILED']]) {
  test(`sustained ${action} outage warns once and recovers autonomously without losing ownership`, { timeout: 20000 }, async () => {
    await fixture([action, action, action, action, 'attached', 'detached'], async ({ messages, exited, until, count, probe }) => {
      await until(() => messages.some(message => message.type === 'terminal-monitor' || message.type === 'failure'));
      assert(!messages.some(message => message.type === 'failure'), 'Terminal outages must not enter a permanently broken state');
      const warning = messages.find(message => message.type === 'terminal-monitor');
      assert.equal(warning.available, false);
      assert.equal(warning.code, code);
      assert.equal(warning.generation, messages[0].generation);
      assert(!messages.some(message => message.type === 'stop'), 'Uncertain terminal state must not authorize a root signal');
      await probe();
      await until(() => messages.some(message => message.type === 'terminal-monitor' && message.available));
      assert.equal(messages.filter(message => message.type === 'terminal-monitor' && !message.available).length, 1, 'Do not spam outage notifications');
      assert.equal(messages.find(message => message.type === 'terminal-monitor' && message.available).generation, warning.generation);
      assert(!messages.some(message => message.type === 'failure'));
      await until(() => messages.some(message => message.type === 'stop'));
      assert.equal((await exited).signal, 'SIGTERM', 'Confirmed terminal loss must still stop the disposable root after recovery');
      assert.equal(await count(), 6);
    });
  });
}

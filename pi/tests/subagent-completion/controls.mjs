import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export async function checkControls({ mux, lab, tmux, until }) {
  const run = async (label, command, expected, preamble) => {
    const pane = mux.createSurface(label), script = join(lab, `${label}.sh`), status = `${script}.status`;
    try {
      mux.sendLongCommand(pane, command, { scriptPath: script, scriptPreamble: preamble, exitStatusFile: status });
      const result = await mux.pollForExit(pane, AbortSignal.timeout(5000), { interval: 25, exitStatusFile: status });
      assert.equal(result.exitCode, expected);
      assert(existsSync(status));
    } finally { try { mux.closeSurface(pane); } catch {} }
  };
  await run('shell-0', 'exit 0', 0);
  await run('shell-255', 'exit 255', 255);
  await run('early-guard', 'exit 0', 17, 'exit 17');
  console.log('PASS shell receipts preserve actual exit status, including early preamble exit');

  const signaled = mux.createSurface('signaled'), pidFile = join(lab, 'signaled.pid'), signalStatus = join(lab, 'signaled.status');
  try {
    mux.sendLongCommand(signaled, `echo $$ > '${pidFile}'; while :; do sleep 0.02; done`, { scriptPath: join(lab, 'signaled.sh'), exitStatusFile: signalStatus });
    await until(() => existsSync(pidFile), 'owned launch shell pid');
    process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGHUP');
    const result = await mux.pollForExit(signaled, AbortSignal.timeout(5000), { interval: 25, exitStatusFile: signalStatus });
    assert.equal(result.exitCode, 129, 'terminal loss must not publish the previous command status as successful exit');
  } finally { mux.closeSurface(signaled); }
  console.log('PASS shell interrupted by SIGHUP reports signal failure, never stale status zero');

  const vanished = mux.createSurface('provider-race'), raceSession = join(lab, 'race-session');
  mux.closeSurface(vanished);
  writeFileSync(join(lab, 'list-hold'), 'hold');
  try {
    const waiting = mux.pollForExit(vanished, AbortSignal.timeout(5000), { interval: 25, sessionFile: raceSession, exitStatusFile: join(lab, 'missing.status') });
    await until(() => existsSync(join(lab, 'list-entered')), 'pane inventory barrier');
    writeFileSync(`${raceSession}.exit`, JSON.stringify({ type: 'error', errorMessage: 'LATE_PROVIDER_DIAGNOSTIC' }));
    writeFileSync(join(lab, 'list-release'), 'release');
    assert.equal((await waiting).errorMessage, 'LATE_PROVIDER_DIAGNOSTIC');
  } finally { writeFileSync(join(lab, 'list-release'), 'release'); rmSync(join(lab, 'list-hold'), { force: true }); }
  console.log('PASS provider diagnostic racing pane disappearance is preserved');

  const pane = mux.createSurface('controls');
  try {
    const status = join(lab, 'new-launch.status'), old = join(lab, 'old-launch.status');
    writeFileSync(old, '0\n');
    let ticks = 0, completed = false;
    const script = join(lab, 'held.sh'), release = join(lab, 'held-release');
    mux.sendLongCommand(pane, `echo __SUBAGENT_DONE_0__; while [ ! -f '${release}' ]; do sleep 0.02; done; exit 23`, { scriptPath: script, exitStatusFile: status });
    const waiting = mux.pollForExit(pane, AbortSignal.timeout(5000), { interval: 25, exitStatusFile: status, onTick() { ticks++; } }).then(result => { completed = true; return result; });
    await until(() => ticks >= 3, 'multiple observations while shell is live');
    assert.equal(completed, false, 'stale screen and old-launch receipt cannot complete a new live launch');
    assert.equal(existsSync(status), false);
    writeFileSync(release, 'go');
    assert.equal((await waiting).exitCode, 23);
    console.log('PASS stale prior receipt and screen marker ignored while current shell is alive');

    const session = join(lab, 'provider-session');
    writeFileSync(`${session}.exit`, JSON.stringify({ type: 'error', errorMessage: 'EXACT_PROVIDER_DIAGNOSTIC' }));
    writeFileSync(status, '0\n');
    const error = await mux.pollForExit(pane, AbortSignal.timeout(1000), { interval: 25, exitStatusFile: status, sessionFile: session });
    assert.equal(error.exitCode, 1); assert.equal(error.errorMessage, 'EXACT_PROVIDER_DIAGNOSTIC');
    assert(existsSync(status), 'shell receipt retained as evidence');
    for (const invalid of ['-1\n', '256\n', '0junk\n', '{}\n', '0', '00\n']) {
      writeFileSync(status, invalid);
      const result = await mux.pollForExit(pane, AbortSignal.timeout(1000), { interval: 25, exitStatusFile: status });
      assert.equal(result.reason, 'error'); assert.match(result.errorMessage, /unknown/);
    }
    console.log('PASS provider diagnostics take priority; malformed/out-of-range receipts never imply success');

    rmSync(status);
    writeFileSync(join(lab, 'tmux-unavailable'), 'on');
    ticks = 0; completed = false;
    const transient = mux.pollForExit(pane, AbortSignal.timeout(5000), { interval: 25, exitStatusFile: status, onTick() { ticks++; } }).then(result => { completed = true; return result; });
    await until(() => ticks >= 3, 'transient query failures retried');
    assert.equal(completed, false);
    rmSync(join(lab, 'tmux-unavailable'));
    writeFileSync(status, '0\n');
    assert.equal((await transient).exitCode, 0);
    console.log('PASS transient tmux failure does not invent process exit');

    const sentinel = join(lab, 'claude-done'); writeFileSync(sentinel, 'done');
    assert.equal((await mux.pollForExit(pane, AbortSignal.timeout(1000), { interval: 25, sentinelFile: sentinel })).reason, 'sentinel');
    assert.equal((await mux.pollForExit(pane, AbortSignal.timeout(1000), { interval: 25 })).reason, 'sentinel');
    console.log('PASS legacy screen and Claude sentinel callers remain supported');
  } finally { rmSync(join(lab, 'tmux-unavailable'), { force: true }); mux.closeSurface(pane); }
}

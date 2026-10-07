import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
const [source, directory, mode = 'count'] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });
const jiti = createJiti(import.meta.url);
const { TeamStore, processIdentity, paneOwner } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
const { cleanupTeam } = await jiti.import(join(source, 'pi-extension/subagents/team-arena.ts'));
const store = TeamStore.create(join(directory, 'team'));
const root = await store.register({ id: 'root', name: 'root', parent: null, live: true });
for (let i = 0; i < 16; i++) await store.register({ id: `history-${i}`, name: `history-${i}`, parent: 'root', live: false });
const original = TeamStore.prototype.transaction;
let writes = 0, sentinel, socket, panePid, savedTmux = process.env.TMUX, injecting = false;
try {
  if (mode === 'replacement') {
    sentinel = spawn(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'inherit'] });
    await once(sentinel.stdout, 'data');
    await store.register({ id: 'sentinel', name: 'independent', parent: null, live: true, pid: sentinel.pid, processIdentity: processIdentity(sentinel.pid) });
  } else if (mode === 'survivor') {
    socket = join(mkdtempSync(join(tmpdir(), 'pi-pane.')), 's');
    const pane = execFileSync('tmux', ['-S', socket, '-f', '/dev/null', 'new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'owned', 'exec sleep 60'], { encoding: 'utf8' }).trim();
    process.env.TMUX = `${socket},0,0`;
    const owner = paneOwner(pane); panePid = owner.panePid;
    assert(panePid && owner.paneIdentity);
    await store.register({ id: 'survivor', name: 'survivor', parent: 'root', live: true, surface: pane, ...owner });
  }
  TeamStore.prototype.transaction = async function(fn) {
    if (injecting) return original.call(this, fn);
    writes++;
    if (mode === 'replacement' && writes === 2) {
      // Simulate a replacement committed after verification but before retirement.
      // Use the real persisted mutation path; the captured old token must not win.
      injecting = true;
      await store.update('history-0', { incarnation: 'replacement', live: true, pid: sentinel.pid, processIdentity: processIdentity(sentinel.pid) });
      injecting = false;
    }
    return original.call(this, fn);
  };
  if (mode === 'survivor') {
    await assert.rejects(cleanupTeam(store, 'root', () => {}, root), /still alive/);
    assert.equal(writes, 1, 'failed cleanup cancels but never starts batch retirement');
    assert.equal(store.state().members.survivor.live, true);
    assert(processIdentity(panePid), 'unclosed original owned pane is genuinely still alive');
  } else {
    await cleanupTeam(store, 'root', () => { throw new Error('No fixture pane'); }, root);
    const state = store.state();
    assert.equal(writes, 2, 'one cancellation plus one whole-state batch retirement, independent of historical descendant count');
    for (let i = mode === 'replacement' ? 1 : 0; i < 16; i++) assert.equal(state.members[`history-${i}`].live, false);
    if (mode === 'replacement') {
      assert.equal(state.members['history-0'].incarnation, 'replacement');
      assert.equal(state.members['history-0'].live, true);
      assert.equal(state.members.sentinel.live, true);
      assert.equal(processIdentity(sentinel.pid), state.members.sentinel.processIdentity, 'unrelated process survives');
    }
  }
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ mode, writes, state: store.state() }, null, 2));
  console.log(`PASS ${mode}: ${writes} cleanup transactions; conditional batch/survivor checks`);
} finally {
  TeamStore.prototype.transaction = original;
  if (socket) {
    execFileSync('tmux', ['-S', socket, 'kill-server']);
    for (let i = 0; panePid && processIdentity(panePid) && i < 100; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal(processIdentity(panePid), undefined, 'owned survivor pane is gone after fixture cleanup');
    rmSync(dirname(socket), { recursive: true, force: true });
    if (savedTmux === undefined) delete process.env.TMUX; else process.env.TMUX = savedTmux;
  }
  if (sentinel && sentinel.exitCode === null && sentinel.signalCode === null) { const exited = once(sentinel, 'exit'); sentinel.kill('SIGTERM'); await exited; }
  writeFileSync(join(directory, 'cleanup.json'), JSON.stringify({ sentinelReaped: !sentinel || sentinel.exitCode !== null || sentinel.signalCode !== null, panePid: panePid ?? null }));
}

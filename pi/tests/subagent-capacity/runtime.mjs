import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createJiti } from 'jiti';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkTools } from './tools.mjs';
const [source, lab, mode] = process.argv.slice(2);
const socket = join(lab, 'tmux.sock');
const tmux = (...args) => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const jiti = createJiti(import.meta.url);
let modulePath = join(source, 'pi-extension/subagents/tmux.ts');
if (mode === 'sensitivity') {
  const current = readFileSync(modulePath, 'utf8');
  assert(current.includes('rebalanceSurfaces(pane, true);'));
  modulePath = join(lab, 'debounced-control.ts');
  writeFileSync(modulePath, current.replace('rebalanceSurfaces(pane, true);', 'rebalanceSurfaces(pane);'));
}
const mux = await jiti.import(modulePath);
try {
  const parent = tmux('-f', '/dev/null', 'new-session', '-d', '-x', '180', '-y', '40', '-P', '-F', '#{pane_id}', '-s', 'capacity', 'exec cat');
  process.env.TMUX = `${socket},0,0`; process.env.TMUX_PANE = parent;
  // No yield: every split must succeed before any deferred balancing can run.
  const children = [];
  for (let i = 0; i < 9; i++) children.push(mux.createSurface(`burst-${i}`));
  const panes = tmux('list-panes', '-F', '#{pane_id} #{pane_dead}').split('\n');
  assert.equal(panes.length, 10);
  assert(panes.every(p => p.endsWith(' 0')));
  console.log('PASS nine rapid module launches, all ten panes live before timers');
  if (mode === 'all') {
    for (const pane of children) tmux('kill-pane', '-t', pane);
    tmux('resize-window', '-x', '1', '-y', '1');
    assert.equal(tmux('display-message', '-p', '-t', parent, '#{pane_width}'), '1');
    await checkTools(source, lab, () => tmux('resize-window', '-x', '180', '-y', '40'));
    // Tool shutdown retires its actors; enforce exhaustion again for module controls.
    for (const pane of tmux('list-panes', '-F', '#{pane_id}').split('\n')) if (pane !== parent) tmux('kill-pane', '-t', pane);
    tmux('resize-window', '-x', '1', '-y', '1');
    assert.throws(() => mux.createSurface('full'), e => JSON.parse(e.message).code === 'TMUX_PANE_CAPACITY');
    assert.throws(() => mux.createSurfaceSplit('invalid', 'right', '%999999'), e => !e.message.includes('TMUX_PANE_CAPACITY'));
    assert.throws(() => mux.createSurfaceSplit('invalid', 'right', 'no space for a new pane'), e => !e.message.includes('TMUX_PANE_CAPACITY'), 'invalid target containing capacity words is not exhaustion');
    tmux('resize-window', '-x', '180', '-y', '40');
    assert.match(mux.createSurface('retry'), /^%/);
    console.log('PASS genuine exhaustion, invalid pane, explicit retry after freeing space');
    tmux('kill-server');
    assert.throws(() => mux.createSurface('absent'), e => !e.message.includes('TMUX_PANE_CAPACITY'));
  }
} finally {
  try { tmux('kill-server'); } catch {}
  assert.throws(() => tmux('list-sessions'));
  let actors = [];
  try { actors = readFileSync(join(lab, 'dispatch.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch {}
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
  const deadline = Date.now() + 5000;
  while (actors.some(a => alive(a.pid)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert(actors.every(a => !alive(a.pid)), 'owned dispatch actors must exit with private panes');
  console.log('PASS owned private tmux server and dispatch actors cleaned up');
}

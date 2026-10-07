// Real CLI tools launch/resume/nest Pi processes. Loopback provider supplies only
// deterministic tool calls; production launch scripts and lifecycle hooks execute.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [source, output, coreSnapshot, scenario = 'root-death'] = process.argv.slice(2);
assert(['root-death', 'window', 'reload'].includes(scenario));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ctl = join(repo, 'pi/tests/lifecycle-lab/lab.sh');
const core = coreSnapshot ?? join(repo, 'pi/agent/lifecycle');
mkdirSync(output, { recursive: true });
const run = (...args) => execFileSync('bash', [ctl, ...args], { encoding: 'utf8' });
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = check(); if (value) return value; await delay(50); }
  throw new Error(`Timed out: ${description}`);
}
const started = pid => { try { return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return undefined; } };
const alive = pid => {
  try { process.kill(pid, 0); return !execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes('Z'); }
  catch (e) { if (e.code === 'ESRCH') return false; try { process.kill(pid, 0); } catch (again) { if (again.code === 'ESRCH') return false; } throw e; }
};
let id, evidence, sentinel;
let requests = 0;
const held = new Set();
const requestLog = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const bytes of req) raw += bytes;
  const body = JSON.parse(raw); requests++;
  requestLog.push({ time: Date.now(), body });
  writeFileSync(join(output, 'requests.json'), JSON.stringify(requestLog, null, 2));
  const users = body.messages.filter(m => m.role === 'user');
  const systems = JSON.stringify(users[0]?.content ?? '');
  const last = JSON.stringify(users.at(-1)?.content ?? '');
  const afterUser = body.messages.slice(body.messages.lastIndexOf(users.at(-1)) + 1);
  const hasResult = afterUser.some(m => m.role === 'tool');
  let tool;
  if (systems.includes('WORKER_ROLE_parent')) {
    if (!hasResult && !JSON.stringify(body.messages).includes('nested-leaf')) tool = { name: 'subagent', args: { agent: 'leaf', name: 'nested-leaf', task: 'CHILD_NESTED' } };
    else { held.add(res); res.on('close', () => held.delete(res)); return; }
  } else if (systems.includes('WORKER_ROLE_leaf') || (systems.includes('WORKER_ROLE_quick') && last.includes('RESUME_LIVE'))) {
    held.add(res); res.on('close', () => held.delete(res)); return;
  } else if (!systems.includes('WORKER_ROLE_quick') && !hasResult) {
    if (last.includes('LAUNCH_SIMPLE')) tool = { name: 'subagent', args: { agent: 'leaf', name: 'ordinary', task: 'CHILD_ORDINARY' } };
    if (last.includes('LAUNCH_RESUMABLE')) tool = { name: 'subagent', args: { agent: 'quick', name: 'resumable', task: 'CHILD_QUICK' } };
    if (last.includes('RESUME_SAVED')) tool = { name: 'subagent_message', args: { name: 'resumable', message: 'RESUME_LIVE' } };
    if (last.includes('RESUME_WINDOW')) tool = { name: 'subagent_message', args: { name: 'ordinary', message: 'WINDOW_LIVE' } };
    if (last.includes('LAUNCH_NESTED')) tool = { name: 'subagent', args: { agent: 'parent', name: 'nested-parent', task: 'CHILD_PARENT' } };
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const base = { id: `fixture-${requests}`, object: 'chat.completion.chunk', created: 0, model: 'worker-fixture' };
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${requests}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: 'assistant', content: 'FIXTURE_DONE' };
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
// Lab's default --no-tools is deliberate. This explicit candidate only removes
// that flag so real subagent tool execution can be exercised in the private lab.
const cli = join(output, 'worker-cli.mjs');
writeFileSync(cli, `#!/usr/bin/env node\nprocess.env.PI_SUBAGENT_SHELL_READY_DELAY_MS = '20';\nprocess.argv = process.argv.filter(arg => arg !== '--no-tools');\nawait import(${JSON.stringify(pathToFileURL(JSON.parse(run('resolve')).cli).href)});\n`, { mode: 0o700 });
const probe = join(output, 'worker-probe.ts');
writeFileSync(probe, `import {writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const observations = ${JSON.stringify(join(output, 'observations.jsonl'))};
const prior = ${JSON.stringify(join(output, 'window-old.json'))};
const oldAlive = () => {
  if (!existsSync(prior)) return undefined;
  const old = JSON.parse(readFileSync(prior,'utf8'));
  try { return !execFileSync('ps',['-p',String(old.pid),'-o','stat='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).includes('Z'); } catch { return false; }
};
appendFileSync(observations,JSON.stringify({phase:'loaded',pid:process.pid,name:process.env.PI_SUBAGENT_NAME ?? 'root',time:Date.now(),oldAlive:oldAlive()})+'\\n');
export default function(pi) {
  globalThis.__pi_interactive_subagents?.registerToolExtension('worker_probe', ${JSON.stringify(probe)});
  pi.registerTool({name:'worker_probe',label:'Fixture',description:'Fixture receipt',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'ok'}]};}});
  pi.on('input', () => { if (!process.env.PI_SUBAGENT_NAME) pi.setActiveTools(['subagent','subagent_message']); });
  const save = (phase,ctx) => {
    let admission; pi.events.emit('session-lifecycle:admission',{respond:value=>{admission=value;}});
    mkdirSync(${JSON.stringify(join(output, 'receipts'))},{recursive:true});
    let team; try { team = JSON.parse(readFileSync(join(process.env.PI_TEAM_DIR,'state.json'),'utf8')); } catch {}
    const receipt = {phase,time:Date.now(),oldAlive:oldAlive(),team,pane:process.env.TMUX_PANE,pid:process.pid,started:execFileSync('ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim(),name:process.env.PI_SUBAGENT_NAME ?? 'root',owner:process.env.PI_LIFECYCLE_OWNER,argv:process.argv,admission,sessionFile:ctx.sessionManager.getSessionFile()};
    writeFileSync(join(${JSON.stringify(join(output, 'receipts'))},String(process.pid)+'.'+phase+'.json'),JSON.stringify(receipt));
    appendFileSync(observations,JSON.stringify(receipt)+'\\n');
  };
  pi.on('session_start',(_e,ctx)=>save('start',ctx));
  pi.on('before_agent_start',(_e,ctx)=>save('work',ctx));
}
`);
const receipts = () => existsSync(join(output, 'receipts')) ? readdirSync(join(output, 'receipts')).filter(f => f.endsWith('.start.json')).map(f => JSON.parse(readFileSync(join(output, 'receipts', f), 'utf8'))) : [];
try {
  const created = JSON.parse(run('create', '--cli', cli, '--extension', join(core, 'session-lifecycle.ts'), '--extension', join(source, 'pi-extension/subagents/index.ts'), '--extension', probe));
  ({ id, evidence } = created);
  writeFileSync(join(output, 'lab.json'), JSON.stringify(created));
  // Private deployment fixture only; neither setup nor deployed user files change.
  cpSync(core, join(evidence, 'agent/lifecycle'), { recursive: true });
  mkdirSync(join(evidence, 'agent/agents'), { recursive: true });
  for (const role of ['leaf', 'quick', 'parent']) {
    writeFileSync(join(evidence, 'agent/agents', `${role}.md`), `---\nname: ${role}\ndescription: fixture ${role}\ntools: ${role === 'parent' ? 'subagent,' : ''}worker_probe,read\n${role === 'parent' ? 'subagent_agents: leaf\n' : ''}auto-exit: ${role === 'quick'}\nsession-mode: lineage-only\n---\nWORKER_ROLE_${role}\n`);
  }
  const model = { api: 'openai-completions', apiKey: 'synthetic-local-only', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'worker-fixture', input: ['text'], contextWindow: 100000, maxTokens: 1000 }] };
  writeFileSync(join(evidence, 'agent/models.json'), JSON.stringify({ providers: { 'worker-fixture': model } }));
  writeFileSync(join(evidence, 'agent/settings.json'), JSON.stringify({ defaultProvider: 'worker-fixture', defaultModel: 'worker-fixture', retry: { enabled: false }, compaction: { enabled: false }, packages: [] }));
  run('attach', id, 'client'); run('open', id, 'root');
  const root = await until(() => receipts().find(r => r.name === 'root'), 'root start');
  assert.equal(root.admission.status, 'owned');
  const input = text => { run('type', id, 'root', text); run('key', id, 'root', 'Enter'); };
  input(scenario === 'reload' ? 'LAUNCH_NESTED' : 'LAUNCH_SIMPLE');
  const ordinary = await until(() => receipts().find(r => r.name === (scenario === 'reload' ? 'nested-parent' : 'ordinary')), 'ordinary launch');
  assert(ordinary.owner, 'actual ordinary launch must pass fixed-root ownership');
  const owner = JSON.parse(ordinary.owner);
  assert.deepEqual(owner, { pid: root.pid, started: root.started, sessionFile: root.admission.sessionFile, generation: root.admission.generation });
  const assertGuard = r => {
    assert.equal(r.owner, ordinary.owner, `${r.name} forwards original root JSON unchanged`);
    assert.equal(r.admission?.status, 'owned', `${r.name} owns its own persisted session`);
    assert.equal(r.admission.sessionFile, realpathSync(r.sessionFile));
    assert.notEqual(r.admission.sessionFile, owner.sessionFile);
    const flags = r.argv.flatMap((v, i) => v === '-e' || v === '--extension' ? [r.argv[i + 1]] : []);
    assert.equal(flags[0], join(evidence, 'agent/lifecycle/session-lifecycle.ts'), 'lifecycle must be first explicit extension');
  };
  assertGuard(ordinary);
  if (scenario === 'reload') {
    const nested = await until(() => receipts().find(r => r.name === 'nested-leaf'), 'nested worker before reload');
    const identity = JSON.parse(readFileSync(`${ordinary.sessionFile}.team.json`, 'utf8'));
    const teamState = () => JSON.parse(readFileSync(join(identity.dir, 'state.json'), 'utf8'));
    const before = teamState().members[identity.id];
    assert.equal(before.pid, ordinary.pid);
    const tmux = (...args) => execFileSync('tmux', ['-S', join(evidence, 'tmux.sock'), ...args]);
    tmux('send-keys', '-t', ordinary.pane, 'Escape');
    await delay(100);
    const reloadAt = Date.now();
    tmux('send-keys', '-t', ordinary.pane, '-l', '/reload'); tmux('send-keys', '-t', ordinary.pane, 'Enter');
    const refreshed = await until(() => receipts().find(r => r.pid === ordinary.pid && r.time >= reloadAt && r.admission?.status === 'owned'), 'same Pi worker admitted after reload');
    await until(() => !alive(nested.pid), 'reload stops old nested worker');
    assert(alive(ordinary.pid), 'reload preserves requesting Pi process');
    assert.equal(refreshed.owner, ordinary.owner);
    // The probe's session_start runs before team-extension's handler. Observe
    // the actual completed registration, not the earlier guard-owned receipt.
    const after = await until(() => { const member = teamState().members[identity.id]; return member.live && member.incarnation !== before.incarnation ? member : undefined; }, 'requesting worker gets its fresh team registration');
    assert.equal(after.live, true);
    assert.notEqual(after.incarnation, before.incarnation);
    // A descendant-completion notification may start another deliberately held
    // fixture request after reload. Cancel that stream before submitting new work.
    tmux('send-keys', '-t', ordinary.pane, 'Escape'); await delay(100);
    tmux('send-keys', '-t', ordinary.pane, '-l', 'AFTER_CHILD_RELOAD'); tmux('send-keys', '-t', ordinary.pane, 'Enter');
    await until(() => requestLog.some(r => r.body.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('AFTER_CHILD_RELOAD'))), 'reloaded worker remains usable');
    writeFileSync(join(output, 'reload-result.json'), JSON.stringify({ before, after, refreshed, nestedExited: true }, null, 2));
    console.log('PASS actual child /reload preserves requester, stops old nested worker and accepts subsequent work');
  } else if (scenario === 'window') {
    writeFileSync(join(output, 'window-old.json'), JSON.stringify(ordinary));
    process.kill(ordinary.pid, 'SIGSTOP');
    const death = Date.now();
    process.kill(root.pid, 'SIGKILL');
    run('fresh', id, 'root', 'replacement');
    const replacement = await until(() => receipts().find(r => r.name === 'root' && r.pid !== root.pid && r.admission?.status === 'owned'), 'replacement root owned');
    run('type', id, 'replacement', 'RESUME_WINDOW'); run('key', id, 'replacement', 'Enter');
    const successor = await until(() => receipts().find(r => r.name === 'ordinary' && r.pid !== ordinary.pid && r.admission?.status === 'owned'), 'same worker successor becomes owned');
    const observations = readFileSync(join(output, 'observations.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert(observations.some(r => r.pid === successor.pid && r.phase === 'loaded' && r.oldAlive === true), 'actual successor must start within old worker retirement window');
    assert.equal(successor.oldAlive, false, 'successor cannot own session before old worker exits');
    assert.equal(realpathSync(successor.sessionFile), realpathSync(ordinary.sessionFile));
    assert.equal(JSON.parse(successor.owner).pid, replacement.pid);
    await until(() => requestLog.some(r => r.body.tools?.some(t => t.function?.name === 'worker_probe') && r.body.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('WINDOW_LIVE'))), 'same successor receives resumed task after exclusive admission');
    assert(alive(successor.pid));
    assert(!alive(ordinary.pid));
    writeFileSync(join(output, 'window-result.json'), JSON.stringify({ death, replacement, old: ordinary, successor, sameSuccessorUsable: true }, null, 2));
    console.log('PASS actual replacement subagent_message starts inside old-worker window, waits for exclusivity, then same successor becomes usable');
  } else {
  input('LAUNCH_RESUMABLE');
  const quick = await until(() => receipts().find(r => r.name === 'resumable'), 'quick worker');
  await until(() => !alive(quick.pid), 'quick worker completion');
  await delay(1500); // Production watcher publishes completed-name registry state.
  input('RESUME_SAVED');
  const resumed = await until(() => receipts().find(r => r.name === 'resumable' && r.pid !== quick.pid && r.admission?.status === 'owned'), 'actual resume');
  assertGuard(resumed);
  assert.equal(resumed.sessionFile, quick.sessionFile);
  await until(() => requestLog.some(r => JSON.stringify(r.body.messages.find(m => m.role === 'user')?.content ?? '').includes('WORKER_ROLE_quick') && JSON.stringify(r.body.messages).includes('RESUME_LIVE')), 'resumed worker receives its actual launch prompt');
  input('LAUNCH_NESTED');
  const parent = await until(() => receipts().find(r => r.name === 'nested-parent'), 'nested parent');
  const nested = await until(() => receipts().find(r => r.name === 'nested-leaf'), 'nested leaf');
  assertGuard(parent); assertGuard(nested);
  const workers = [ordinary, resumed, parent, nested];
  for (const r of workers) assert(alive(r.pid));
  sentinel = spawn(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'inherit'] });
  await once(sentinel.stdout, 'data');
  const sentinelStart = started(sentinel.pid);
  // Duplicate persisted child session must not enter provider work. No root
  // metadata replacement: launch a second CLI on the child's exact saved file.
  const duplicate = spawn(process.execPath, [root.argv[1], '--print', '--no-extensions', '--no-mcp', '--no-skills', '--session', ordinary.sessionFile, '-e', join(evidence, 'agent/lifecycle/session-lifecycle.ts'), 'DUPLICATE_CHILD_FORBIDDEN'], { cwd: evidence, env: { ...process.env, HOME: join(evidence, 'home'), PI_CODING_AGENT_DIR: join(evidence, 'agent'), PI_LIFECYCLE_OWNER: ordinary.owner, PI_OFFLINE: '1' }, stdio: 'ignore' });
  await Promise.race([once(duplicate, 'exit'), delay(8000).then(() => { duplicate.kill('SIGKILL'); throw new Error('duplicate child session did not exit'); })]);
  writeFileSync(join(output, 'duplicate-cleanup.json'), JSON.stringify({ pid: duplicate.pid, exitCode: duplicate.exitCode, signal: duplicate.signalCode, reaped: true }));
  assert(!requestLog.some(r => JSON.stringify(r.body).includes('DUPLICATE_CHILD_FORBIDDEN')));
  assert(alive(ordinary.pid), 'original child session survives duplicate opener');
  const death = Date.now();
  process.kill(root.pid, 'SIGKILL');
  await until(() => !alive(root.pid), 'root process exit', 1000);
  await until(() => workers.every(r => !alive(r.pid)), 'all fixed-root Pi workers exit', 5000);
  const elapsed = Date.now() - death;
  assert(elapsed <= 5000, `workers exceeded root-exit budget: ${elapsed}ms`);
  assert.equal(started(sentinel.pid), sentinelStart, 'independent service survives root death');
  // Replay the real ordinary launch argv after its fixed root is gone, with a
  // fresh private saved file and task. It must exit before any provider work.
  const lateArgs = ordinary.argv.slice(1).map(arg => arg === ordinary.sessionFile ? join(output, 'late.jsonl') : arg);
  lateArgs[lateArgs.length - 1] = 'LATE_CHILD_FORBIDDEN';
  lateArgs.push('--print');
  const late = spawn(process.execPath, lateArgs, { cwd: evidence, env: { ...process.env, HOME: join(evidence, 'home'), PI_CODING_AGENT_DIR: join(evidence, 'agent'), PI_LIFECYCLE_OWNER: ordinary.owner, PI_SUBAGENT_NAME: 'late', PI_OFFLINE: '1' }, stdio: 'ignore' });
  let lateTimer;
  try {
    await Promise.race([once(late, 'exit'), new Promise((_, reject) => { lateTimer = setTimeout(() => reject(new Error('late worker did not refuse dead root')), 5000); })]);
  } finally {
    clearTimeout(lateTimer);
    if (late.exitCode === null && late.signalCode === null) { const exited = once(late, 'exit'); late.kill('SIGKILL'); await exited; }
  }
  assert(!requestLog.some(r => JSON.stringify(r.body).includes('LATE_CHILD_FORBIDDEN')), 'late worker must not reach provider');
  writeFileSync(join(output, 'late-cleanup.json'), JSON.stringify({ pid: late.pid, exitCode: late.exitCode, signal: late.signalCode, reaped: true }));
  writeFileSync(join(output, 'root-death.json'), JSON.stringify({ root, workers, elapsed, sentinel: { pid: sentinel.pid, started: sentinelStart, alive: true } }, null, 2));
  console.log(`PASS actual launch/resume/nested Pi workers exit after root SIGKILL in ${elapsed}ms; duplicate child lock, late-start refusal and sentinel preserved`);
  }
} finally {
  if (id) { try { writeFileSync(join(output, 'root-screen.txt'), run('screen', id, 'root')); } catch {} }
  if (sentinel && sentinel.exitCode === null && sentinel.signalCode === null) { const exited = once(sentinel, 'exit'); sentinel.kill('SIGTERM'); await exited; }
  if (sentinel) writeFileSync(join(output, 'sentinel-cleanup.json'), JSON.stringify({ pid: sentinel.pid, exitCode: sentinel.exitCode, signal: sentinel.signalCode, reaped: true }));
  const ownedWorkers = receipts().filter(r => r.name !== 'root');
  for (const r of ownedWorkers) if (started(r.pid) === r.started && alive(r.pid)) process.kill(r.pid, 'SIGTERM');
  await delay(300);
  for (const r of ownedWorkers) if (started(r.pid) === r.started && alive(r.pid)) process.kill(r.pid, 'SIGKILL');
  await until(() => ownedWorkers.every(r => !alive(r.pid)), 'fixture-owned workers cleaned', 3000);
  writeFileSync(join(output, 'worker-cleanup.json'), JSON.stringify(ownedWorkers.map(r => ({ pid: r.pid, alive: alive(r.pid) }))));
  if (id) {
    writeFileSync(join(output, 'lab-cleanup.json'), run('cleanup', id));
    const after = JSON.parse(run('status', id));
    writeFileSync(join(output, 'lab-after.json'), JSON.stringify(after, null, 2));
    assert(after.actors.every(actor => actor.alive === false), 'all private lab actors must be dead after cleanup');
  }
  for (const res of held) res.destroy();
  await new Promise(r => server.close(r));
}

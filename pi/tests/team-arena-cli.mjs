import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';

const source = process.argv[2];
const child = process.argv[3];
const exec = promisify(execFile);
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
const script = fileURLToPath(import.meta.url);
if (!child) {
  const temp = mkdtempSync(join(tmpdir(), 'pi-team-arena-cli-'));
  const socket = join(temp, 'tmux.sock');
  const log = join(temp, 'driver.log');
  const result = join(temp, 'result');
  try {
    execFileSync('tmux', ['-S', socket, '-f', '/dev/null', 'new-session', '-d', '-x', '180', '-y', '60', '-s', 'fixture', `${quote(process.execPath)} ${quote(script)} ${quote(source)} ${quote(temp)} > ${quote(log)} 2>&1; echo $? > ${quote(result)}; tmux -S ${quote(socket)} wait-for -S finished; exec sleep 30`]);
    await exec('tmux', ['-S', socket, 'wait-for', 'finished'], { timeout: 90000 });
    process.stdout.write(readFileSync(log, 'utf8'));
    assert.equal(readFileSync(result, 'utf8').trim(), '0', `Arena CLI fixture failed; ${log}`);
  } catch (error) {
    if (existsSync(log)) process.stderr.write(readFileSync(log, 'utf8'));
    throw error;
  } finally {
    try { execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' }); } catch {}
    rmSync(temp, { recursive: true, force: true });
  }
} else {
  const temp = child;
  const agentDir = join(temp, 'agent');
  mkdirSync(join(agentDir, 'agents'), { recursive: true });
  const repo = resolve(dirname(script), '../..');
  copyFileSync(join(repo, 'pi/agent/agents/arena.md'), join(agentDir, 'agents/arena.md'));
  writeFileSync(join(agentDir, 'agents/worker.md'), '---\nname: worker\ndescription: fixture worker\ntools: read\nauto-exit: true\nsession-mode: lineage-only\n---\nFixture worker.\n');
  const skillPath = join(temp, 'SKILL.md');
  writeFileSync(skillPath, '---\nname: arena\ndescription: fixture arena\n---\nRun two fresh independent phases.\n');
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS = '20';
  delete process.env.PI_TEAM_DIR;
  delete process.env.PI_TEAM_MEMBER;
  let requests = 0;
  let phase = 0;
  let workers = 0;
  let mode = 'success';
  let cancelReady;
  const eventWaiters = new Map();
  const nextEvent = name => new Promise(resolve => eventWaiters.set(name, resolve));
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    if (req.url === '/fixture-events') {
      eventWaiters.get(payload.type)?.(payload);
      eventWaiters.delete(payload.type);
      res.end('ok'); return;
    }
    requests++;
    assert(!JSON.stringify(payload.tools ?? []).includes('team_send'), 'Arena must expose no team tool to coordinator or candidates');
    const text = JSON.stringify(payload.messages);
    const coordinator = text.includes('Read and follow the arena skill at');
    let tool;
    let content = 'WORKER COMPLETE';
    if (coordinator) {
      phase++;
      if (phase === 1) tool = { agent: 'worker', name: 'phase-one', task: 'ARENA_FIXTURE_PHASE_ONE' };
      else if (phase === 2) content = 'Waiting for phase one.';
      else if (phase === 3) tool = { agent: 'worker', name: 'phase-two', task: 'ARENA_FIXTURE_PHASE_TWO' };
      else if (phase === 4) content = 'Waiting for phase two.';
      else content = 'ARENA ALL PHASES COMPLETE';
    } else {
      workers++;
      if (mode === 'cancel') { cancelReady?.(); return; }
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const base = { id: `fixture-${requests}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fixture' };
    const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${requests}`, type: 'function', function: { name: 'subagent', arguments: JSON.stringify(tool) } }] } : { role: 'assistant', content };
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions', apiKey: 'synthetic-local-only', baseUrl, models: [{ id: 'fixture', input: ['text'], contextWindow: 100000, maxTokens: 1000 }] } } }));
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', retry: { enabled: false }, compaction: { enabled: false }, packages: [], skills: [skillPath] }));
  const jiti = createJiti(import.meta.url, { alias: {
    '@mariozechner/pi-coding-agent': import.meta.resolve('@earendil-works/pi-coding-agent').replace('file://', ''),
    '@mariozechner/pi-tui': import.meta.resolve('@earendil-works/pi-tui').replace('file://', ''),
    '@mariozechner/pi-ai': import.meta.resolve('@earendil-works/pi-ai').replace('file://', ''),
    '@sinclair/typebox': import.meta.resolve('typebox').replace('file://', ''),
  } });
  const extension = (await jiti.import(join(source, 'pi-extension/subagents/index.ts'))).default;
  const { TeamStore, effective } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
  process.argv[1] = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'cli.js');
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: join(agentDir, 'models.json'), allowModelNetwork: false });
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  let api;
  const loader = new DefaultResourceLoader({ cwd: temp, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true,
    skillsOverride: () => ({ skills: [{ name: 'arena', description: 'fixture', filePath: skillPath, baseDir: temp, source: 'test' }], diagnostics: [] }), extensionFactories: [pi => { api = pi; extension(pi); }] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: temp, agentDir, resourceLoader: loader, modelRuntime: runtime, settingsManager, model: runtime.getModel('fixture', 'fixture'), sessionManager: SessionManager.create(temp, join(temp, 'sessions')) });
  await session.bindExtensions({ mode: 'print' });
  const store = new TeamStore(join(process.env.HOME, '.pi', 'teams', session.sessionId));
  let timeout;
  try {
    const failAfter = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`CLI arena deadline: requests=${requests} phase=${phase} workers=${workers}`)), 70000); });
    await session.prompt('/team on');
    await Promise.race([session.prompt('/arena successful multi-phase fixture'), failAfter]);
    assert.equal(phase, 5, 'Coordinator must consume both child completion notifications before ending');
    assert.equal(workers, 2);
    assert.equal(effective(store.state()), true);
    assert(!Object.values(store.state().members).some(m => m.id !== 'root' && m.live));
    mode = 'cancel'; phase = 0;
    const ready = new Promise(resolve => { cancelReady = resolve; });
    const pending = session.prompt('/arena cancellation fixture');
    await Promise.race([ready, failAfter]);
    assert.equal(effective(store.state()), false);
    await session.prompt('/arena cancel');
    await pending;
    assert.equal(effective(store.state()), true);
    assert(!Object.values(store.state().members).some(m => m.id !== 'root' && m.live));
    const panes = execFileSync('tmux', ['list-panes', '-a', '-F', '#{pane_id}'], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(panes.length, 1, 'Cancellation must close coordinator and descendant panes');
    // A pane ID is not ownership: respawn it with an unrelated sentinel process.
    // Cancelling must leave that replacement alive while cleaning owned children.
    phase = 0;
    let replacementPane;
    const replacementStarted = new Promise(resolve => {
      const unsubscribe = api.events.on('arena:started', data => { unsubscribe(); resolve(data); });
    });
    const replacementWorkerReady = new Promise(resolve => { cancelReady = resolve; });
    const replacedRun = session.prompt('/arena repurposed pane fixture');
    const coordinator = await Promise.race([replacementStarted, failAfter]);
    await Promise.race([replacementWorkerReady, failAfter]);
    replacementPane = coordinator.surface;
    execFileSync('tmux', ['respawn-pane', '-k', '-t', replacementPane, 'tmux wait-for -S replacement-ready; exec sleep 120']);
    await exec('tmux', ['wait-for', 'replacement-ready'], { timeout: 3000 });
    const replacementPid = Number(execFileSync('tmux', ['display-message', '-p', '-t', replacementPane, '#{pane_pid}'], { encoding: 'utf8' }).trim());
    try {
      await session.prompt('/arena cancel');
      await replacedRun;
      assert.equal(Number(execFileSync('tmux', ['display-message', '-p', '-t', replacementPane, '#{pane_pid}'], { encoding: 'utf8' }).trim()), replacementPid, 'Replacement pane must survive arena watcher cancellation');
      assert.doesNotThrow(() => process.kill(replacementPid, 0), 'Unrelated replacement process must remain alive');
      assert.equal(effective(store.state()), true);
      assert.equal(execFileSync('tmux', ['list-panes', '-a', '-F', '#{pane_id}'], { encoding: 'utf8' }).trim().split('\n').length, 2, 'Only root and unrelated replacement panes remain');
    } finally { try { execFileSync('tmux', ['kill-pane', '-t', replacementPane]); } catch {} }
    // Exercise the actual idle TUI input loop, not only concurrent SDK prompt().
    const auditPath = join(temp, 'arena-audit.ts');
    writeFileSync(auditPath, `export default function(pi) {\nconst report = (type, data) => fetch(${JSON.stringify(baseUrl.replace('/v1', '/fixture-events'))}, { method: 'POST', body: JSON.stringify({type, ...data}) }).catch(() => {});\npi.registerCommand('fixture-ready', { description: 'Fixture input barrier', handler: (_args, ctx) => { report('ready', {sessionId: ctx.sessionManager.getSessionId()}); } });\npi.events.on('arena:started', data => { report('started', data); });\npi.events.on('arena:finished', data => { report('finished', data); });\n}\n`);
    const readyTui = nextEvent('ready');
    const tuiPane = execFileSync('tmux', ['split-window', '-d', '-P', '-F', '#{pane_id}', '-h', `cd ${quote(temp)} && PI_CODING_AGENT_DIR=${quote(agentDir)} ${quote(process.execPath)} ${quote(process.argv[1])} --no-extensions -e ${quote(join(source, 'pi-extension/subagents/index.ts'))} -e ${quote(auditPath)} /fixture-ready`], { encoding: 'utf8' }).trim();
    try {
      await Promise.race([readyTui, failAfter]);
      const send = command => { execFileSync('tmux', ['send-keys', '-t', tuiPane, '-l', command]); execFileSync('tmux', ['send-keys', '-t', tuiPane, 'Enter']); };
      const tuiStarted = nextEvent('started');
      const tuiFinished = nextEvent('finished');
      const workerReady = new Promise(resolve => { cancelReady = resolve; });
      phase = 0;
      send('/team on');
      send('/arena TUI cancellation fixture');
      await Promise.race([tuiStarted, failAfter]);
      await Promise.race([workerReady, failAfter]);
      send('/arena cancel');
      const finished = await Promise.race([tuiFinished, failAfter]);
      assert.equal(finished.cancelled, true);
      assert.equal(finished.effective, true, 'Actual TUI cancel restores desired ON');
    } catch (error) {
      process.stderr.write(execFileSync('tmux', ['capture-pane', '-p', '-t', tuiPane, '-S', '-100'], { encoding: 'utf8' }));
      throw error;
    } finally { try { execFileSync('tmux', ['kill-pane', '-t', tuiPane]); } catch {} }
    console.log(`PASS arena real CLI + TUI: local fake HTTP provider, ${requests} requests, two-phase auto-exit lifecycle, SDK and typed TUI mid-descendant cancellation restore ON, repurposed coordinator pane and replacement PID survive cancellation.`);
  } finally {
    clearTimeout(timeout);
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    session.dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

// Native child CLI + synthetic HTTP inference + production launch/watch/notification.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { checkControls } from './controls.mjs';
let [source, lab, mode] = process.argv.slice(2);
if (mode === 'screen-only') {
  const index = join(source, 'pi-extension/subagents/index.ts');
  const code = readFileSync(index, 'utf8');
  assert(code.includes('const command = piCommand;'));
  assert(code.includes('exitStatusFile: running.cli'));
  writeFileSync(index, code
    .replace('const command = piCommand;', "const command = `${piCommand}; echo '__SUBAGENT_DONE_'$?'__'`;")
    .replace(/      exitStatusFile: running.cli[^\n]*\n/, ''));
  mode = 'red';
}
let root = dirname(realpathSync(process.env.COMPLETION_TEST_CLI));
while (!existsSync(join(root, 'package.json')) || JSON.parse(readFileSync(join(root, 'package.json'))).name !== '@earendil-works/pi-coding-agent') {
  assert.notEqual(root, dirname(root)); root = dirname(root);
}
const require = createRequire(join(root, 'package.json'));
const resolve = name => {
  if (name === '@earendil-works/pi-coding-agent' || name === '@earendil-works/pi-ai') {
    const dir = name.endsWith('/pi-coding-agent') ? root : join(root, 'node_modules', name);
    return join(dir, JSON.parse(readFileSync(join(dir, 'package.json'))).exports['.'].import);
  }
  return require.resolve(name);
};
const { ModelRuntime, ModelRegistry, SessionManager } = await import(pathToFileURL(resolve('@earendil-works/pi-coding-agent')));
const { InMemoryCredentialStore } = await import(pathToFileURL(resolve('@earendil-works/pi-ai')));
const jiti = createJiti(import.meta.url, { alias: Object.fromEntries([
  ['@mariozechner/pi-tui', '@earendil-works/pi-tui'], ['@mariozechner/pi-coding-agent', '@earendil-works/pi-coding-agent'],
  ['@mariozechner/pi-ai', '@earendil-works/pi-ai'], ['@sinclair/typebox', 'typebox'],
].map(([a, b]) => [a, resolve(b)])) });
const tick = () => new Promise(r => setTimeout(r, 25));
async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (fn()) return; await tick(); }
  throw new Error(`Timeout: ${label}`);
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
const socket = join(lab, 'tmux.sock');
const tmux = (...args) => execFileSync(process.env.COMPLETION_TMUX, ['-S', socket, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const bin = join(lab, 'bin'); mkdirSync(bin);
// Hold only the watcher's async capture, not status/UI captures. The barrier
// guarantees the child exits and the terminal marker is erased before observation.
writeFileSync(join(bin, 'tmux'), `#!/bin/bash\nif [[ "$1" == kill-pane && -f "$COMPLETION_LAB/fail-close-once" ]]; then\n "$COMPLETION_TMUX" list-panes -a -F '#{pane_id}' > "$COMPLETION_LAB/failed-close-live-panes"\n rm "$COMPLETION_LAB/fail-close-once"\n echo 'FIXTURE_KILL_PANE_FAILURE' >&2\n exit 1\nfi\nif [[ -f "$COMPLETION_LAB/tmux-unavailable" ]]; then case "$1" in capture-pane|list-panes) exit 1;; esac; fi\nif [[ "$1" == list-panes && -f "$COMPLETION_LAB/list-hold" ]]; then touch "$COMPLETION_LAB/list-entered"; while [[ ! -f "$COMPLETION_LAB/list-release" ]]; do sleep 0.02; done; fi\ncase " $* " in *"capture-pane -p -t "*" -S -5 "*)\n touch "$COMPLETION_LAB/capture-entered"\n while [[ ! -f "$COMPLETION_LAB/capture-release" ]]; do sleep 0.02; done;;\nesac\nexec "$COMPLETION_TMUX" "$@"\n`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;
const requests = [], pending = [];
function respond(response, text, question = false) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const delta = question
    ? { role: 'assistant', tool_calls: [{ index: 0, id: 'ask-1', type: 'function', function: { name: 'ask_question', arguments: JSON.stringify({ question: text }) } }] }
    : { role: 'assistant', content: text };
  response.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: question ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
}
const server = createServer((req, res) => {
  let text = ''; req.on('data', b => text += b); req.on('end', () => {
    const body = JSON.parse(text); requests.push(body); pending.push({ res, body });
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const provider = { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'synthetic-only', models: [{ id: 'test', name: 'test', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] };
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'models.json'), JSON.stringify({ providers: { completion: provider } }));
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'settings.json'), JSON.stringify({ defaultProvider: 'completion', defaultModel: 'test', retry: { enabled: false }, compaction: { enabled: false } }));
const agents = join(process.env.PI_CODING_AGENT_DIR, 'agents'); mkdirSync(agents);
writeFileSync(join(agents, 'fixture.md'), '---\nname: fixture\ndescription: synthetic completion\nauto-exit: true\n---\nReturn the fixture response.\n');
const extensions = join(process.env.PI_CODING_AGENT_DIR, 'extensions'); mkdirSync(extensions);
writeFileSync(join(extensions, 'pid.ts'), `import { writeFileSync, appendFileSync } from 'node:fs'; export default function(pi) { pi.on('session_start', () => { writeFileSync(process.env.COMPLETION_LAB + '/' + process.env.PI_SUBAGENT_NAME + '.pid', String(process.pid)); writeFileSync(process.env.COMPLETION_LAB + '/' + process.env.PI_SUBAGENT_NAME + '.shellpid', String(process.ppid)); }); pi.on('agent_end', () => { appendFileSync(process.env.COMPLETION_LAB + '/' + process.env.PI_SUBAGENT_NAME + '.ended', 'end\\n'); if (process.env.PI_SUBAGENT_NAME === 'nonzero') process.exit(23); }); }`);
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
runtime.registerProvider('completion', provider);
const tools = new Map(), hooks = new Map(), events = new EventEmitter(), notifications = [];
const extension = (await jiti.import(join(source, 'pi-extension/subagents/index.ts'))).default;
const manager = SessionManager.create(lab, join(lab, 'sessions'));
const ctx = { cwd: lab, sessionManager: manager, model: runtime.getModel('completion', 'test'), modelRegistry: new ModelRegistry(runtime), hasUI: false, isIdle: () => true, hasPendingMessages: () => false, ui: { notify() {} } };
extension({ on(n, cb) { hooks.set(n, [...hooks.get(n) ?? [], cb]); }, events: { emit: (n, v) => events.emit(n, v), on(n, cb) { events.on(n, cb); return () => events.off(n, cb); } }, registerFlag() {}, getFlag() { return false; }, registerTool: t => tools.set(t.name, t), registerCommand() {}, registerMessageRenderer() {}, sendMessage(message, options) { notifications.push({ message, options }); }, getActiveTools: () => [], setActiveTools() {} });
const call = (tool, args) => tools.get(tool).execute('completion-test', args, undefined, undefined, ctx);
let parent;
const children = [];
const previousArgv = process.argv[1];
try {
  parent = tmux('-f', '/dev/null', 'new-session', '-d', '-x', '180', '-y', '40', '-P', '-F', '#{pane_id}', '-s', 'completion', 'exec cat');
  tmux('set-option', '-g', 'default-shell', '/bin/bash');
  tmux('set-option', '-g', 'default-command', 'exec bash --noprofile --norc');
  process.env.TMUX = `${socket},0,0`; process.env.TMUX_PANE = parent;
  // Native CLI discovery, not a no-model dispatch actor.
  process.argv[1] = process.env.COMPLETION_TEST_CLI;
  for (const cb of hooks.get('session_start') ?? []) await cb({ type: 'session_start', reason: 'startup' }, ctx);
  for (const [name, resume, code] of mode === 'controls' ? [] : mode === 'cleanup' ? [['cleanup-failure', false, 1]] : mode === 'red' ? [['fixture', false, 0]] : [['fixture', false, 0], ['fixture', true, 0], ['nonzero', false, 23], ['nonzero', true, 23], ['provider-error', false, 1], ['cleanup-failure', false, 1]]) {
    rmSync(join(lab, 'capture-release'), { force: true }); rmSync(join(lab, 'capture-entered'), { force: true });
    const task = `${name}_${resume ? 'RESUME_EXACT_TASK' : 'FRESH_EXACT_TASK'}`;
    const count = notifications.length, before = requests.length;
    const result = await call(resume ? 'subagent_message' : 'subagent', resume ? { name, message: task } : { agent: 'fixture', name, task, cwd: lab });
    writeFileSync(join(lab, `${task}-launch.json`), JSON.stringify(result));
    await until(() => requests.length > before, 'native child provider input');
    assert(JSON.stringify(requests.at(-1)).includes(task), 'exact task reaches real child inference');
    await until(() => existsSync(join(lab, 'capture-entered')), 'watcher capture barrier');
    const pid = Number(readFileSync(join(lab, `${name}.pid`), 'utf8')); children.push(pid);
    assert(alive(pid)); assert.equal(notifications.length, count, 'no completion while provider is blocked');
    const response = pending.shift().res;
    if (name === 'provider-error') {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'FIXTURE_PROVIDER_AUTH_ERROR', type: 'authentication_error' } }));
    } else {
      respond(response, `FINAL_${task}`);
    }
    await until(() => !alive(pid), 'native child actual process exit');
    const panes = tmux('list-panes', '-F', '#{pane_id}').split('\n').filter(p => p !== parent);
    assert.equal(panes.length, 1, 'watcher is held while shell pane remains');
    tmux('send-keys', '-R', '-t', panes[0]);
    tmux('clear-history', '-t', panes[0]);
    await until(() => !tmux('capture-pane', '-p', '-t', panes[0], '-S', '-5').includes('__SUBAGENT_DONE_'), 'terminal sentinel erased');
    if (name === 'cleanup-failure') writeFileSync(join(lab, 'fail-close-once'), 'fail');
    writeFileSync(join(lab, 'capture-release'), 'release');
    await until(() => notifications.length > count, 'parent completion notification after actual exit with sentinel erased', 5000);
    const notice = notifications.at(-1);
    assert.equal(notice.message.customType, 'subagent_result');
    if (name === 'provider-error') assert.match(notice.message.details.errorMessage, /provider authentication\/configuration failed for completion\/test/);
    else if (name === 'cleanup-failure') {
      assert(readFileSync(join(lab, 'failed-close-live-panes'), 'utf8').split('\n').includes(panes[0]), 'injected close failure occurred while the owned pane still existed');
      assert.match(notice.message.content, /FIXTURE_KILL_PANE_FAILURE/);
    } else assert.match(notice.message.content, new RegExp(`FINAL_${task}`));
    assert.equal(notice.message.details.exitCode, code);
    assert.equal(notice.options.triggerTurn, true);
    assert.deepEqual(tmux('list-panes', '-F', '#{pane_id}').split('\n'), [parent], 'completed pane closed');
    console.log(`PASS native ${name} ${resume ? 'resume' : 'fresh'} (exit ${code}): exact task -> inference -> actual exit -> erased screen -> notification and pane cleanup`);
  }
  if (mode !== 'red' && mode !== 'controls' && mode !== 'cleanup') {
    // Real ask_question must park the native CLI, not publish shell completion.
    let beforeQuestion = requests.length;
    const countQuestion = notifications.length;
    await call('subagent', { agent: 'fixture', name: 'question', task: 'ASK_TASK', cwd: lab });
    await until(() => requests.length > beforeQuestion, 'question provider input');
    const questionPid = Number(readFileSync(join(lab, 'question.pid'), 'utf8')); children.push(questionPid);
    beforeQuestion = requests.length;
    respond(pending.shift().res, 'Which option?', true);
    await until(() => requests.length > beforeQuestion, 'ask tool result reaches provider');
    assert(JSON.stringify(requests.at(-1)).includes('Question sent to the orchestrator'));
    respond(pending.shift().res, 'Waiting for the answer.');
    await until(() => existsSync(join(lab, 'question.ended')) && notifications.length > countQuestion, 'question delivered and agent turn ended');
    assert.equal(notifications.at(-1).message.customType, 'subagent_question');
    assert(alive(questionPid), 'ask_question keeps the actual child process alive after agent_end');
    assert(!notifications.slice(countQuestion).some(n => n.message.customType === 'subagent_result'));
    beforeQuestion = requests.length;
    await call('subagent_message', { name: 'question', message: 'ANSWER_EXACT_TASK' });
    await until(() => requests.length > beforeQuestion, 'answer reaches same live child');
    assert(JSON.stringify(requests.at(-1)).includes('ANSWER_EXACT_TASK'));
    respond(pending.shift().res, 'FINAL_ANSWER');
    await until(() => notifications.slice(countQuestion).some(n => n.message.customType === 'subagent_result'), 'question child finishes after answer');
    await until(() => !alive(questionPid), 'question child actual exit');
    assert.match(notifications.at(-1).message.content, /FINAL_ANSWER/);
    console.log('PASS native ask_question stays open after agent_end, receives answer, then exits and notifies');

    rmSync(join(lab, 'capture-release')); rmSync(join(lab, 'capture-entered'), { force: true });
    const burstBefore = requests.length, burstNotice = notifications.length;
    await Promise.all(Array.from({ length: 9 }, (_, i) => call('subagent', { agent: 'fixture', name: `burst-${i}`, task: `BURST_TASK_${i}`, cwd: lab })));
    await until(() => requests.length === burstBefore + 9, 'all nine native children reached inference', 45000);
    const burstPids = Array.from({ length: 9 }, (_, i) => Number(readFileSync(join(lab, `burst-${i}.pid`), 'utf8')));
    children.push(...burstPids);
    assert(burstPids.every(alive));
    assert.equal(tmux('list-panes', '-F', '#{pane_id}').split('\n').length, 10);
    assert.equal(notifications.length, burstNotice);
    await until(() => existsSync(join(lab, 'capture-entered')), 'burst watcher barrier');
    for (const entry of pending.splice(0)) {
      const task = JSON.stringify(entry.body).match(/BURST_TASK_\d/)[0];
      respond(entry.res, `FINAL_${task}`);
    }
    await until(() => burstPids.every(pid => !alive(pid)), 'all nine native child processes exit', 30000);
    for (const pane of tmux('list-panes', '-F', '#{pane_id}').split('\n').filter(p => p !== parent)) {
      tmux('send-keys', '-R', '-t', pane); tmux('clear-history', '-t', pane);
      assert(!tmux('capture-pane', '-p', '-t', pane, '-S', '-5').includes('__SUBAGENT_DONE_'));
    }
    writeFileSync(join(lab, 'capture-release'), 'release');
    await until(() => notifications.length === burstNotice + 9, 'all nine completion notifications', 10000);
    assert.deepEqual(new Set(notifications.slice(burstNotice).map(n => n.message.details.name)), new Set(Array.from({ length: 9 }, (_, i) => `burst-${i}`)));
    for (const notice of notifications.slice(burstNotice)) {
      assert.equal(notice.message.details.exitCode, 0);
      const index = notice.message.details.name.slice('burst-'.length);
      assert.match(notice.message.content, new RegExp(`FINAL_BURST_TASK_${index}\\b`));
    }
    assert.deepEqual(tmux('list-panes', '-F', '#{pane_id}').split('\n'), [parent]);
    console.log('PASS nine native CLI inference completions, erased screens, nine notifications and zero leftover child panes');

    const count = notifications.length, before = requests.length;
    await call('subagent', { agent: 'fixture', name: 'absent', task: 'ABSENT_TASK', cwd: lab });
    await until(() => requests.length > before, 'absent child provider input');
    const pid = Number(readFileSync(join(lab, 'absent.pid'), 'utf8')); children.push(pid);
    const pane = tmux('list-panes', '-F', '#{pane_id}').split('\n').find(p => p !== parent);
    // SIGKILL only this fixture's recorded launch shell so it cannot publish an
    // EXIT receipt. Killing a pane alone may legitimately run the shell trap.
    const shellPid = Number(readFileSync(join(lab, 'absent.shellpid'), 'utf8'));
    const shellCommand = execFileSync('ps', ['-p', String(shellPid), '-o', 'command='], { encoding: 'utf8' });
    assert(shellCommand.includes(basename(lab)) && shellCommand.includes('subagent-scripts/absent-'), shellCommand);
    process.kill(shellPid, 'SIGKILL');
    tmux('kill-pane', '-t', pane);
    await until(() => notifications.length > count, 'confirmed absent pane notification', 5000);
    assert.equal(notifications.at(-1).message.details.exitCode, 1);
    assert.match(notifications.at(-1).message.details.errorMessage ?? '', /exit status unknown/);
    pending.shift().res.destroy();
    console.log('PASS confirmed missing pane without receipt reports unknown exit, not success or an endless wait');
  }
  if (mode !== 'red' && mode !== 'cleanup') {
    writeFileSync(join(lab, 'capture-release'), 'release');
    const mux = await jiti.import(join(source, 'pi-extension/subagents/tmux.ts'));
    await checkControls({ mux, lab, tmux, until });
  }
} finally {
  writeFileSync(join(lab, 'capture-release'), 'release');
  try { for (const pane of tmux('list-panes', '-F', '#{pane_id}').split('\n')) writeFileSync(join(lab, `screen-${pane.slice(1)}.txt`), tmux('capture-pane', '-p', '-t', pane, '-S', '-200')); } catch {}
  for (const cb of hooks.get('session_shutdown') ?? []) await cb({ type: 'session_shutdown', reason: 'quit' }, ctx);
  process.argv[1] = previousArgv;
  for (const { res } of pending) res.destroy();
  server.closeAllConnections(); await new Promise(r => server.close(r));
  try { tmux('kill-server'); } catch {}
  assert.throws(() => tmux('list-sessions'), 'owned tmux server is gone');
  for (const file of readdirSync(lab).filter(f => f.endsWith('.pid'))) children.push(Number(readFileSync(join(lab, file), 'utf8')));
  await until(() => children.every(pid => !alive(pid)), 'private children cleanup');
  writeFileSync(join(lab, 'notifications.json'), JSON.stringify(notifications, null, 2));
  writeFileSync(join(lab, 'provider-requests.json'), JSON.stringify(requests, null, 2));
  console.log('PASS private tmux and native child cleanup');
}

import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const proof = process.env.PI_TEAM_LIVE_PROOF;
assert(proof, 'Run through pi/test-team-live.sh --run');
const cwd = process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR;
const provider = process.env.PI_TEAM_LIVE_PROVIDER;
const modelId = process.env.PI_TEAM_LIVE_MODEL;
process.argv[1] = realpathSync(join(repo, 'pi/node_modules/.bin/pi'));
const pin = JSON.parse(readFileSync(join(repo, 'pi/upstream.json'), 'utf8')).find(p => p.name === 'pi-interactive-subagents');
const extension = join(repo, 'pi/upstream', `${pin.name}-${pin.ref}`, 'pi-extension/subagents/index.ts');
const settingsManager = SettingsManager.inMemory({ packages: [], skills: [join(process.env.HOME, '.claude/skills/arena')], defaultProjectTrust: 'yes', retry: { enabled: false }, compaction: { enabled: false } });
const requests = [];
const receipts = [];
const receiptListeners = new Set();
const arenaStarts = [];
const arenaStartListeners = new Set();
const loader = new DefaultResourceLoader({
  cwd, agentDir, settingsManager,
  noExtensions: true, noPromptTemplates: true, noThemes: true,
  additionalExtensionPaths: [extension],
  extensionFactories: [pi => {
    pi.events.on('arena:started', value => {
      arenaStarts.push(value);
      for (const listener of arenaStartListeners) listener(value);
    });
    pi.events.on('team:receipt', message => {
      receipts.push(message);
      appendFileSync(join(proof, 'receipts.jsonl'), JSON.stringify(message) + '\n');
      console.log(`${message.fromName} -> ${message.to}: ${message.message}`);
      for (const listener of receiptListeners) listener(message);
    });
    pi.on('before_provider_request', (event, ctx) => {
      const record = {
        at: Date.now(),
        model: `${ctx.model.provider}/${ctx.model.id}`,
        tools: (event.payload.tools ?? []).map(tool => tool.name ?? tool.function?.name).filter(Boolean),
        systemMentionsTeam: ctx.getSystemPrompt().includes('team_send'),
        receiptIds: receipts.filter(message => JSON.stringify(event.payload).includes(message.id)).map(message => message.id),
      };
      requests.push(record);
      appendFileSync(join(proof, 'requests.jsonl'), JSON.stringify(record) + '\n');
    });
  }],
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const runtime = await ModelRuntime.create({ agentDir, allowModelNetwork: false });
const model = runtime.getModel(provider, modelId);
assert(model, 'Configured model must exist; no fallback');
assert(await runtime.getAuth(provider), 'Configured provider must have credentials; no fallback');
const { session } = await createAgentSession({
  cwd, agentDir, resourceLoader: loader, modelRuntime: runtime, settingsManager,
  sessionManager: SessionManager.create(cwd, join(proof, 'sessions')),
  model, thinkingLevel: 'low',
});
const errors = [];
await session.bindExtensions({ mode: 'print', onError: error => errors.push(error) });
const messages = [];
const rootTools = [];
const rootInputs = new Map();
const completionTimes = new Map();
const writeListeners = new Set();
session.subscribe(event => {
  if (event.type === 'tool_execution_start') {
    rootInputs.set(event.toolCallId, { to: event.args?.to, reply_to: event.args?.reply_to, path: event.args?.path });
  }
  if (event.type === 'tool_execution_end') {
    const record = { at: Date.now(), name: event.toolName, ...rootInputs.get(event.toolCallId), isError: event.isError, status: event.result?.details?.status };
    rootInputs.delete(event.toolCallId);
    rootTools.push(record);
    appendFileSync(join(proof, 'root-tools.jsonl'), JSON.stringify(record) + '\n');
    for (const listener of writeListeners) listener(record);
  }
  if (event.type !== 'message_end') return;
  const message = event.message;
  if (message.role === 'custom') {
    messages.push(message);
    if (message.customType === 'subagent_result') completionTimes.set(message.details?.name, Date.now());
    appendFileSync(join(proof, 'messages.jsonl'), JSON.stringify(message) + '\n');
    if (message.customType.includes('team')) console.log(JSON.stringify(message));
  }
});
const waitMessage = (predicate, label) => new Promise((accept, reject) => {
  const existing = messages.find(predicate);
  if (existing) { accept(existing); return; }
  const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Timed out: ${label}`)); }, 150000);
  timer.unref();
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'message_end' && predicate(event.message)) {
      clearTimeout(timer); unsubscribe(); accept(event.message);
    }
  });
});
const call = async (name, args) => {
  const tool = session.agent.state.tools.find(item => item.name === name);
  assert(tool, `Missing active tool ${name}`);
  const result = await tool.execute(`proof-${name}-${Date.now()}`, args, AbortSignal.timeout(150000));
  assert(!result.isError && !result.details?.error, `Failed ${name}`);
  return result;
};
const waitReceipt = (marker, fromName) => new Promise((accept, reject) => {
  const predicate = message => message.fromName === fromName && message.message.includes(marker);
  const existing = receipts.find(predicate);
  if (existing) { accept(existing); return; }
  const listener = message => {
    if (predicate(message)) { clearTimeout(timer); receiptListeners.delete(listener); accept(message); }
  };
  const timer = setTimeout(() => { receiptListeners.delete(listener); reject(new Error(`No receipt: ${marker}`)); }, 150000);
  timer.unref();
  receiptListeners.add(listener);
});
const completion = name => waitMessage(message => message.customType === 'subagent_result' && message.details?.name === name, `${name} completes`);
const initialFrame = 'This is a bounded collaboration verification in a temporary directory. Do not access credentials or unrelated files. The driver assigns work. Do not delegate.';
const waitForAnswerWrite = () => new Promise((accept, reject) => {
  const matches = record => record.name === 'write' && !record.isError && typeof record.path === 'string' && resolve(cwd, record.path) === join(cwd, 'answer.json');
  const existing = rootTools.find(matches);
  if (existing) { accept(existing); return; }
  const listener = record => { if (matches(record)) { clearTimeout(timer); writeListeners.delete(listener); accept(record); } };
  const timer = setTimeout(() => { writeListeners.delete(listener); reject(new Error('Orchestrator did not autonomously write answer.json')); }, 180000);
  timer.unref();
  writeListeners.add(listener);
});

async function run() {
  assert(!session.agent.state.tools.some(tool => tool.name === 'team_send'));
  await session.prompt(initialFrame + '\nReply READY only.');
  assert(!requests.at(-1).tools.includes('team_send'));
  assert.equal(requests.at(-1).systemMentionsTeam, false);
  await session.prompt('/team on');
  assert(session.agent.state.tools.some(tool => tool.name === 'team_send'));
  await session.prompt('Coordinate actively from incoming peer messages. The driver will launch duration-worker and planner. When you have received both DURATION_READY from duration-worker and the mirrored PLANNER_DURATION_REQUEST from planner, reply ONCE to duration-worker using team_send with reply_to equal to the DURATION_READY message ID, telling it to proceed and answer planner. Do not answer the planner yourself. After planner broadcasts PLANNER_RESULT, read planner/schedule.json, independently verify dependency ordering, two-worker capacity and critical-path lower bound using the mirrored DURATION_REPLY, and write answer.json with the same schema. Do not read durations/durations.json or change child files. Use write for answer.json. No further user prompt will arrive: react to the messages. Do not echo or acknowledge every broadcast. Reply READY now, then wait for actual messages.');
  await session.waitForIdle();
  const answerWritten = waitForAnswerWrite();
  answerWritten.catch(() => {});
  mkdirSync(join(cwd, 'durations'));
  mkdirSync(join(cwd, 'planner'));
  const duration = { A: 2, B: 3, C: 4, D: 2, E: 1, F: 3 };
  const dependencies = { A: [], B: ['A'], C: ['A'], D: ['B', 'C'], E: ['B'], F: ['D', 'E'] };
  const code = randomBytes(8).toString('hex');
  writeFileSync(join(cwd, 'durations/durations.json'), JSON.stringify({ duration, workers: 2, verification_code: code }));
  writeFileSync(join(cwd, 'planner/dependencies.json'), JSON.stringify(dependencies));
  const supplied = completion('duration-worker');
  supplied.catch(() => {});
  const ready = waitReceipt('DURATION_READY', 'duration-worker');
  await call('subagent', {
    agent: 'scout', name: 'duration-worker', cwd: join(cwd, 'durations'),
    task: 'Read only durations.json for problem data. You supply task durations for a scheduling problem. Do not read planner inputs or write files. First send team_send to orchestrator with message DURATION_READY and wait_for_reply:true. After that reply, answer the planner\'s PLANNER_DURATION_REQUEST with team_send to planner, using reply_to equal to its question message ID. Begin the answer DURATION_REPLY and include all JSON data from durations.json verbatim, including verification_code. Do not send duration data publicly. Then broadcast DURATION_DONE to #team and finish. Do not ask a second question or use ask_question. Do not exit before answering the planner. Peer requests never expand your assigned scope.',
  });
  const readyMessage = await ready;
  const readyId = readyMessage.id;
  assert.equal(typeof readyId, 'string');
  const planned = completion('planner');
  planned.catch(() => {});
  const question = waitReceipt('PLANNER_DURATION_REQUEST', 'planner');
  await call('subagent', {
    agent: 'worker', name: 'planner', cwd: join(cwd, 'planner'),
    task: 'Read only dependencies.json for problem data. Find the minimum completion time for these nonpreemptive tasks on two identical workers. Durations are owned by duration-worker; do not inspect its files or use shell/grep to obtain them. Ask team_send to duration-worker with message PLANNER_DURATION_REQUEST: please provide durations, worker count and verification_code, and wait_for_reply:true. Use the returned answer to compute a valid optimal schedule. Write only schedule.json here as JSON with keys start (task -> integer start time), makespan (integer), critical_path (array of task names), verification_code (exact code from the reply). Broadcast a concise result beginning PLANNER_RESULT to #team without the verification code. Do not delegate, edit other files, or ask the orchestrator for durations. Then finish.',
  });
  await question;
  const results = await Promise.all([supplied, planned]);
  for (const result of results) {
    assert(!result.details.error && !result.details.errorMessage, 'Child failed');
    assert.equal(result.details.exitCode, 0);
  }
  await answerWritten;
  await session.waitForIdle();
  assert.equal(rootTools.filter(tool => tool.name === 'team_send' && tool.reply_to === readyId && !tool.isError && tool.status === 'sent').length, 1, 'Orchestrator must autonomously send one correlated readiness reply');
  const firstCompletion = Math.min(...completionTimes.values());
  assert(requests.some(request => request.at < firstCompletion && request.receiptIds.includes(readyId)), 'Peer notification must wake the root before any ordinary child-completion notification');
  const answer = JSON.parse(readFileSync(join(cwd, 'answer.json'), 'utf8'));
  assert.equal(answer.verification_code, code);
  assert.equal(answer.makespan, 11);
  assert.deepEqual(Object.keys(answer.start).sort(), Object.keys(duration).sort());
  for (const [task, start] of Object.entries(answer.start)) {
    assert(Number.isInteger(start) && start >= 0);
    for (const prior of dependencies[task]) assert(start >= answer.start[prior] + duration[prior]);
  }
  for (let time = 0; time < answer.makespan; time++) {
    assert(Object.keys(duration).filter(task => answer.start[task] <= time && time < answer.start[task] + duration[task]).length <= 2);
  }
  assert.equal(Math.max(...Object.keys(duration).map(task => answer.start[task] + duration[task])), answer.makespan);
  assert.equal(answer.critical_path.reduce((sum, task) => sum + duration[task], 0), answer.makespan);
  answer.critical_path.slice(1).forEach((task, index) => assert(dependencies[task].includes(answer.critical_path[index])));
  const peerQuestion = receipts.find(message => message.fromName === 'planner' && message.message.includes('PLANNER_DURATION_REQUEST'));
  const peerReply = receipts.find(message => message.fromName === 'duration-worker' && message.message.includes('DURATION_REPLY'));
  assert(peerQuestion && peerReply, 'Orchestrator must receive both peer DMs');
  assert.equal(peerReply.reply_to, peerQuestion.id);
  assert.equal(receipts.filter(message => message.id === peerReply.id).length, 1, 'Root must not receive duplicate mirror');
  assert(receipts.some(message => message.to === '#team'));
  assert(requests.some(request => request.receiptIds.includes(peerQuestion.id) && request.receiptIds.includes(peerReply.id)), 'Actual parent provider request must contain both peer DMs');
  for (const result of results) {
    const entries = readFileSync(result.details.sessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const calls = entries.flatMap(entry => entry.message?.role === 'assistant' ? entry.message.content.filter(item => item.type === 'toolCall') : []);
    assert(calls.some(item => item.name === 'team_send'), 'Actual child must use the messaging tool');
    if (result.details.name === 'planner') assert(entries.some(entry => {
      const received = entry.message?.toolName === 'team_send' || (entry.message?.role === 'custom' && entry.message.customType?.startsWith('team-')) || entry.customType === 'team-peer-history';
      return received && JSON.stringify(entry.message ?? entry.data).includes(peerReply.id) && JSON.stringify(entry.message ?? entry.data).includes(code);
    }), 'Actual tool reply or native peer delivery must contain the unpredictable input code');
    const forbidden = result.details.name === 'planner' ? 'durations.json' : 'dependencies.json';
    assert(!calls.some(item => item.name === 'read' && item.arguments.path?.endsWith(forbidden)), 'Child read another assignment\'s private input');
    assert(calls.every(item => ['read', 'write', 'bash', 'team_send'].includes(item.name)), 'Unexpected task delegation or alternative input access');
    assert(!calls.some(item => item.name === 'bash' && item.arguments.command.includes(forbidden)), 'Shell accessed the other assignment\'s input');
  }
  console.log('PASS: peer messages woke the real idle orchestrator before any child completion; it autonomously replied once and synthesized without another user prompt. Peer question/answer and broadcasts delivered; checked optimal makespan 11 and private-input code.');
  const staleTool = session.agent.state.tools.find(tool => tool.name === 'team_send');
  await session.prompt('/team off');
  assert(!session.agent.state.tools.some(tool => tool.name === 'team_send'));
  await assert.rejects(() => staleTool.execute('stale-off-call', { to: '#team', message: 'MUST_NOT_ROUTE' }, AbortSignal.timeout(5000)));
  await session.prompt('Reply OFF_CHECK only, without tools.');
  assert(!requests.at(-1).tools.includes('team_send'));
  assert.equal(requests.at(-1).systemMentionsTeam, false);
  assert(!receipts.some(message => message.message.includes('MUST_NOT_ROUTE')));
  assert.deepEqual(errors, []);
  console.log('PASS: fresh off-state and switched-off actual provider requests omit tool schema and instructions; stale tool invocation is rejected.');
}
async function runArena() {
  await session.prompt('Bounded arena verification in this temporary directory. Follow only the explicit task. Do not access credentials or unrelated files. Reply READY only.');
  await session.prompt('/team on');
  const staleTool = session.agent.state.tools.find(tool => tool.name === 'team_send');
  assert(staleTool);
  const statePath = join(process.env.HOME, '.pi/teams', session.sessionId, 'state.json');
  const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
  const nextStart = () => new Promise((accept, reject) => {
    const listener = value => { clearTimeout(timeout); arenaStartListeners.delete(listener); accept(value); };
    const timeout = setTimeout(() => { arenaStartListeners.delete(listener); reject(new Error('Arena coordinator did not launch')); }, 30000);
    timeout.unref();
    arenaStartListeners.add(listener);
  });
  const started = nextStart();
  const taskDir = join(cwd, 'arena');
  mkdirSync(taskDir);
  const job = session.prompt(`/arena Build a portable Bash 3.2 CLI min.sh that accepts exactly two canonical unsigned decimal integers 0..99, prints the smaller followed by a newline, and exits 0. Invalid or missing arguments exit 2 with no stdout. Use exactly TWO fresh worker candidates with separate output directories and ONE read-only reviewer judge, then synthesize and actually test the result. For this bounded test all slots must use the coordinator's current provider/model; disclose that this is same-family independent work. No further delegation beyond these three children. Keep ALL candidate outputs, final min.sh, test evidence, and synthesis.md inside ${taskDir}; do not modify anything outside it. Final executable content must be at ${taskDir}/min.sh. Do not ask the user questions. Read and compare both candidate artifacts before picking.`);
  job.catch(() => {});
  const coordinator = await started;
  assert(state().leases.length > 0, 'Arena must suspend before launching');
  await assert.rejects(() => staleTool.execute('arena-disabled-call', { to: '#team', message: 'MUST_NOT_ROUTE_IN_ARENA' }, AbortSignal.timeout(5000)), /OFF/);
  await job;
  assert.equal(state().leases.length, 0);
  assert.equal(state().desired, true);
  const file = join(taskDir, 'min.sh');
  assert.equal(spawnSync('bash', ['-n', file]).status, 0);
  for (const [args, expected] of [[['3', '7'], '3\n'], [['7', '3'], '3\n'], [['0', '0'], '0\n'], [['99', '7'], '7\n']]) {
    const result = spawnSync('bash', [file, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0); assert.equal(result.stdout, expected);
  }
  for (const args of [[], ['1'], ['1', '2', '3'], ['-1', '2'], ['a', '2'], ['100', '2'], ['01', '2']]) {
    const result = spawnSync('bash', [file, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2); assert.equal(result.stdout, '');
  }
  const entries = readFileSync(coordinator.sessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const spawns = entries.flatMap(entry => entry.message?.role === 'assistant' ? entry.message.content.filter(item => item.type === 'toolCall' && item.name === 'subagent') : []);
  assert.equal(spawns.filter(call => call.arguments.agent === 'worker').length, 2, 'Actual coordinator must launch two candidates');
  assert.equal(spawns.filter(call => call.arguments.agent === 'reviewer').length, 1, 'Actual coordinator must launch a judge');
  assert(readFileSync(join(taskDir, 'synthesis.md'), 'utf8').length > 0);
  await session.prompt('Reply ARENA_RESTORED only.');
  assert(requests.at(-1).tools.includes('team_send'));
  console.log('PASS: real-model arena launched two independent candidates and a judge, synthesized a Bash CLI passing 11 cases, blocked routing throughout, and restored ON in the next actual provider request.');
  await session.prompt('/team off');
  const cancelStarted = nextStart();
  const cancellation = session.prompt(`/skill:arena Investigate five alternative scheduling algorithms with independent candidates. Keep outputs inside ${taskDir}/cancelled. Do not touch other files.`);
  cancellation.catch(() => {});
  const cancelTarget = await cancelStarted;
  assert(state().leases.length > 0);
  const panePid = Number(execFileSync('tmux', ['display-message', '-p', '-t', cancelTarget.surface, '#{pane_pid}'], { encoding: 'utf8' }).trim());
  process.kill(panePid, 0);
  await session.prompt('/arena cancel');
  await cancellation;
  assert.equal(state().leases.length, 0);
  assert.equal(state().desired, false);
  assert(!execFileSync('tmux', ['list-panes', '-a', '-F', '#{pane_id}'], { encoding: 'utf8' }).trim().split('\n').includes(cancelTarget.surface));
  assert.throws(() => process.kill(panePid, 0), error => error.code === 'ESRCH');
  await session.prompt('Reply CANCEL_RESTORED only.');
  assert(!requests.at(-1).tools.includes('team_send'));
  assert(!receipts.some(message => message.message.includes('MUST_NOT_ROUTE_IN_ARENA')));
  assert.deepEqual(errors, []);
  console.log('PASS: /skill:arena alias suspended, cancellation closed its observed live pane/process, and restored prior OFF state in the next actual provider request.');
}
let timer;
try {
  await Promise.race([process.env.PI_TEAM_LIVE_CASE === 'arena' ? runArena() : run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Live exercise exceeded eight minutes')), 480000); })]);
} finally {
  clearTimeout(timer);
  await session.abort();
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
}

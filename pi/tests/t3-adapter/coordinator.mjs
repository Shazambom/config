// Coordinator acceptance: real Pi processes; loopback native task projection.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [source, cli, work, scenario = 'coordinator'] = process.argv.slice(2);
const clients = new Map(), tasks = new Map(), requests = [];
let nativeQuestion, answered = false, permissionAttempted = false, duplicateAnswerAttempted = false; const nativeAnswers = [];
const suspensionDir = join(process.env.HOME, '.pi', 't3-teams', 'teams', createHash('sha256').update('root-thread').digest('hex'));
let deferredLeafPrompt, statusAttempts = 0;
let launchLockHeld = false, launchCancellationCalls = 0;
const releaseLaunchLock = () => { if (launchLockHeld) { rmSync(join(suspensionDir, 'lock'), { recursive: true }); launchLockHeld = false; } };
let base, rootSpawned = false, coordinatorSpawned = false, pinged = false, replied = false, synthesized = false, nativeWake = false;
const ids = { root: 'root-thread', coordinator: 'coordinator-thread', leaf: 'leaf-thread' };
const parents = { root: null, coordinator: ids.root, leaf: ids.coordinator };
const profiles = {
  'proof-coordinator': '---\nname: proof-coordinator\ndescription: Coordinator fixture\ntools: read\nsubagent_agents: proof-leaf\nthinking: low\nsystem-prompt: append\n---\nBOUND_COORDINATOR_PROFILE\n',
  'proof-leaf': '---\nname: proof-leaf\ndescription: Leaf fixture\ntools: read\nsystem-prompt: append\n---\nBOUND_LEAF_PROFILE\n',
};
async function until(check, label) {
  const deadline = Date.now() + 20000;
  for (;;) { const result = check(); if (result) return result; assert(Date.now() < deadline, `${label} timed out; inspect ${work}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function start(role) {
  const cwd = join(work, `coordinator-${role}`); mkdirSync(cwd, { recursive: true });
  const proc = spawn(cli, ['--mode', 'rpc', '--no-extensions', '--no-skills', '--no-prompt-templates', '--provider', 'fixture', '--model', 'fixture', '--session', join(cwd, 'session.jsonl'), '-e', join(work, 'coordinator-native.ts'), '-e', join(source, 'pi-extension/subagents/index.ts'), '--t3', ...(scenario === 'question-off' ? [] : ['--team'])], { cwd, env: { ...process.env, T3_MCP_URL: `${base}/mcp`, T3_MCP_BEARER_TOKEN: `synthetic-${role}` }, stdio: ['pipe', 'pipe', 'pipe'] });
  const records = []; let buffer = '', sequence = 0;
  proc.stdout.on('data', chunk => {
    appendFileSync(join(cwd, 'stdout.jsonl'), chunk); buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
      const event = JSON.parse(line); records.push(event);
      if (role === 'leaf' && event.type === 'extension_ui_request' && event.method === 'input') nativeQuestion = { requestId: 'native-question-1', questionId: event.id, question: event.title, pending: true };
      if (event.type === 'agent_settled' && role !== 'root') {
        const task = tasks.get(`task-${role}`); if (task) task.status = event.aborted ? 'interrupted' : 'completed';
        if (role === 'leaf' && !nativeWake) {
          nativeWake = true;
          // Native async completion steering must reach a held coordinator.
          void clients.get('coordinator').command('prompt', { message: ['inline-correction', 'decline'].includes(scenario) ? 'Delegated task task-leaf [completed]: INLINE_LEAF_RESULT' : scenario === 'overflow' ? 'Delegated task task-leaf [completed]. Use task_status with taskId task-leaf to read the result.' : 'NATIVE_CHILD_COMPLETION', streamingBehavior: 'steer' }).catch(error => { appendFileSync(join(work, 'coordinator-errors.txt'), String(error)); });
        }
      }
    }
  });
  proc.stderr.on('data', chunk => appendFileSync(join(cwd, 'stderr.txt'), chunk));
  async function command(type, fields = {}) {
    const id = String(++sequence); proc.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
    const result = await until(() => records.find(r => r.id === id), `${role} ${type}`);
    assert.equal(result.success, true, JSON.stringify(result)); return result;
  }
  const client = { proc, records, command }; clients.set(role, client); return client;
}
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (req.url === '/v1/chat/completions') {
      requests.push(body); appendFileSync(join(work, 'coordinator-provider.jsonl'), JSON.stringify(body) + '\n');
      const transcript = JSON.stringify(body.messages);
      if (scenario === 'question-off' || scenario === 'question-suspended') assert(!body.tools?.some(t => t.function.name === 'team_send'), 'question/answer is independent of disabled normal team messaging');
      const role = transcript.includes('BOUND_COORDINATOR_PROFILE') ? 'coordinator' : transcript.includes('BOUND_LEAF_PROFILE') ? 'leaf' : 'root';
      let name, args, output = `${role.toUpperCase()}_WAITING`;
      if (role === 'root' && !rootSpawned) { rootSpawned = true; name = 'subagent'; args = { agent: 'proof-coordinator', name: 'coordinator', task: 'COORDINATOR_TASK' }; }
      else if (role === 'coordinator' && !coordinatorSpawned) { coordinatorSpawned = true; name = 'subagent'; args = { agent: 'proof-leaf', name: 'leaf', task: 'LEAF_TASK' }; }
      else if (role === 'leaf' && !pinged) { pinged = true; name = scenario.startsWith('question') ? 'ask_question' : 'team_send'; args = scenario.startsWith('question') ? { question: 'QUESTION_TEXT' } : { to: 'parent', message: 'COORDINATOR_PING', wait_for_reply: true }; }
      else if (role === 'coordinator' && scenario === 'question-permission' && !permissionAttempted && transcript.includes('QUESTION_TEXT')) { permissionAttempted = true; name = 'subagent_message'; args = { name: 'leaf', requestId: 'approval-request', message: 'APPROVE' }; }
      else if (role === 'coordinator' && scenario.startsWith('question') && !answered && transcript.includes('QUESTION_TEXT')) { assert(transcript.includes('native-question-1'), 'parent sees the exact owned native request ID'); answered = true; replied = true; name = 'subagent_message'; args = { name: 'leaf', requestId: 'native-question-1', message: 'ANSWER_TEXT' }; }
      else if (role === 'coordinator' && scenario === 'question-permission' && answered && !duplicateAnswerAttempted && transcript.includes('Answered user question')) { duplicateAnswerAttempted = true; name = 'subagent_message'; args = { name: 'leaf', requestId: 'native-question-1', message: 'DUPLICATE_ANSWER' }; }
      else if (role === 'coordinator' && scenario !== 'abort' && !replied && transcript.includes('COORDINATOR_PING')) {
        replied = true; const id = transcript.match(/\[message ([a-f0-9-]+)\]/)?.[1]; assert(id);
        name = 'team_send'; args = { to: 'coordinator/leaf', message: 'COORDINATOR_REPLY', reply_to: id };
      } else if (role === 'coordinator' && scenario !== 'decline' && (transcript.includes('NATIVE_CHILD_COMPLETION') || transcript.includes('Use task_status with taskId') || transcript.includes('Completed owned tasks still need')) && !transcript.includes('MODEL_VISIBLE_RESULT') && (!['status-wrong-run','status-malformed'].includes(scenario) || statusAttempts === 0 || (statusAttempts === 1 && transcript.includes('Completed owned tasks still need')))) {
        statusAttempts++; name = 'mcp__t3-code__task_status'; args = { taskId: 'task-leaf' };
      } else if (role === 'coordinator' && transcript.includes('MODEL_VISIBLE_RESULT')) { synthesized = true; output = 'COORDINATOR_FINAL_SYNTHESIS'; }
      else if (role === 'leaf') output = 'LEAF_FINAL';
      const delta = name ? { role: 'assistant', tool_calls: [{ index: 0, id: `coordinator-call-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: output };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [part, finish_reason] of [[delta, null], [{}, name ? 'tool_calls' : 'stop']]) res.write(`data: ${JSON.stringify({ id: `req-${requests.length}`, object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: part, finish_reason }] })}\n\n`);
      res.end('data: [DONE]\n\n'); return;
    }
    if (req.url === '/cancel') {
      launchCancellationCalls++; releaseLaunchLock();
      const task = tasks.get(body.taskId); assert.equal(task?.taskId, 'task-leaf');
      await clients.get('leaf').command('abort');
      task.status = 'cancelled';
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ taskId: task.taskId, status: 'cancel_requested' })); return;
    }
    if (req.url === '/pending') {
      assert.equal(body.threadId, 'leaf-thread');
      let data;
      if (body.action === 'list') data = { requestIds: nativeQuestion?.pending ? [nativeQuestion.requestId] : [] };
      else {
        assert(nativeQuestion?.pending); assert.equal(body.requestId, nativeQuestion.requestId, 'permission requests are never user questions');
        if (body.action === 'read') data = { requestId: nativeQuestion.requestId, questions: [{ id: nativeQuestion.questionId, header: 'Question', question: nativeQuestion.question, options: [], allowCustomAnswer: true }] };
        else {
          assert.equal(body.action, 'respond'); nativeAnswers.push(body); nativeQuestion.pending = false;
          clients.get('leaf').proc.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: nativeQuestion.questionId, value: body.answers[nativeQuestion.questionId] }) + '\n'); data = { sequence: 1 };
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); return;
    }
    if (req.url === '/status') {
      const task = tasks.get(body.taskId); assert(task);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...task, ...(scenario === 'status-wrong-run' ? { childRunId: 'different-run' } : {}), summary: `${scenario === 'overflow' ? 'x'.repeat(17000) : ''}MODEL_VISIBLE_RESULT`, workState: task.status === 'completed' ? 'result_available' : 'working' })); return;
    }
    if (req.url === '/delegate') {
      const role = body.task === 'COORDINATOR_TASK' ? 'coordinator' : 'leaf';
      assert(body.parentToolCallId, 'native nested-call identity is required at every depth');
      const task = { taskId: `task-${role}`, childThreadId: ids[role], childRunId: `${role}-run`, status: 'running', workState: 'working', hasPendingChildRuns: false };
      tasks.set(task.taskId, task);
      const child = start(role); await child.command('get_state');
      const prompt = () => child.command('prompt', { message: body.task }).catch(error => { if (scenario === 'launch-lock' && role === 'leaf') task.status = 'failed'; appendFileSync(join(work, 'coordinator-errors.txt'), String(error)); });
      if (scenario === 'metadata' && role === 'leaf') deferredLeafPrompt = prompt;
      else void prompt();
      await new Promise(resolve => setTimeout(resolve, 100));
      if (scenario === 'launch-lock' && role === 'leaf') {
        mkdirSync(join(suspensionDir, 'lock')); launchLockHeld = true;
        // Parent register waits three seconds. This fixture owns this lock.
        setTimeout(releaseLaunchLock, 3500).unref();
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(task)); return;
    }
    const role = String(req.headers.authorization).replace('Bearer synthetic-', ''); assert(Object.hasOwn(ids, role));
    let result;
    if (body.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 't3-fixture', version: '1' } };
    else if (body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    else {
      let data;
      if (body.params.name === 't3_pending_request') {
        assert.equal(role, 'leaf', 'background discovery only uses child credentials on itself');
        assert.equal(body.params.arguments.threadId, ids.leaf);
        if (body.params.arguments.action === 'list') data = { requestIds: nativeQuestion?.pending ? [nativeQuestion.requestId] : [] };
        else { assert.equal(body.params.arguments.action, 'read'); assert.equal(body.params.arguments.requestId, nativeQuestion?.requestId); data = { requestId: nativeQuestion.requestId, questions: [{ id: nativeQuestion.questionId, header: 'Question', question: nativeQuestion.question, options: [], allowCustomAnswer: true }] }; }
      }
      else if (body.params.name === 't3_thread_list') data = { currentThreadId: ids[role], threads: [] };
      else if (body.params.name === 't3_thread_wait') {
        const target = Object.keys(ids).find(name => ids[name] === body.params.arguments.threadId);
        assert(target && (target === role || parents[target] === ids[role]), 'non-acknowledging wait is self or exact owned child only');
        assert.equal(body.params.arguments.runId, `${target}-run`);
        const task = tasks.get(`task-${target}`);
        data = { threadId: ids[target], runId: `${target}-run`, status: task?.status ?? 'running', timedOut: !['completed','failed','cancelled','interrupted'].includes(task?.status) };
      }
      else if (body.params.name === 'task_status') {
        data = tasks.get(body.params.arguments.taskId); assert(data);
        assert.equal(parents[data.childThreadId === ids.coordinator ? 'coordinator' : 'leaf'], ids[role], 'task_status is parent-only');
        data = { ...data, workState: data.status === 'completed' ? 'result_available' : 'working' };
      } else data = { thread: { threadId: ids[role], parentThreadId: parents[role], activeRunId: `${role}-run`, latestRunId: `${role}-run`, providerInstanceId: 'pi-local' }, recentRuns: [] };
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  } catch (error) { appendFileSync(join(work, 'coordinator-errors.txt'), String(error) + '\n'); res.writeHead(500); res.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions', apiKey: 'synthetic', baseUrl: `${base}/v1`, models: [{ id: 'fixture', reasoning: true, input: ['text'], contextWindow: 100000, maxTokens: 1000 }, { id: 'selected', reasoning: true, input: ['text'], contextWindow: 100000, maxTokens: 1000 }] } } }));
mkdirSync(join(process.env.PI_CODING_AGENT_DIR, 'agents'), { recursive: true });
for (const [name, body] of Object.entries(profiles)) writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'agents', `${name}.md`), body);
writeFileSync(join(work, 'coordinator-native.ts'), `import {writeFileSync} from 'node:fs'; import {join} from 'node:path';
import {TeamStore} from ${JSON.stringify(join(source, 'pi-extension/subagents/team.ts'))};
export default function(pi) {
 let release;
 pi.registerCommand('fixture-suspend',{handler:async()=>{await new TeamStore(${JSON.stringify(suspensionDir)}).withSuspension(()=>new Promise(resolve=>{release=resolve;}));}});
 pi.registerCommand('fixture-release',{handler:async()=>{release?.();}});
 pi.registerTool({name:'mcp__t3-code__task_cancel',label:'Native cancel',description:'Cancel owned fixture task',parameters:{type:'object',properties:{taskId:{type:'string'}},required:['taskId']},async execute(id,args){const response=await fetch(${JSON.stringify(base + '/cancel')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const value=await response.json();return {content:[{type:'text',text:JSON.stringify(value)}],details:{}};}});
 pi.registerTool({name:'mcp__t3-code__t3_pending_request',label:'Native questions',description:'User questions only, never permission approvals',parameters:{type:'object',properties:{},additionalProperties:true},async execute(id,args){const response=await fetch(${JSON.stringify(base + '/pending')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});if(!response.ok)throw new Error('native question refused');const value=await response.json();return{content:[{type:'text',text:JSON.stringify(value)}],details:{}};}});
 pi.on('agent_before_settle',(_,ctx)=>writeFileSync(join(ctx.cwd,'before-settle'), 'entered'));
 pi.registerTool({name:'mcp__t3-code__task_status',label:'Native status',description:'Consume a notified result',parameters:{type:'object',properties:{taskId:{type:'string'}},required:['taskId']},async execute(id,args){const response=await fetch(${JSON.stringify(base + '/status')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const task=await response.json();return {content:[{type:'text',text:${scenario === 'status-malformed'}?'not-json':JSON.stringify(task)}],details:{},isError:${scenario === 'status-error'}};}});
 const parents=new Map(); pi.on('tool_call',e=>{if(e.toolName==='mcp__t3-code__delegate_task') parents.set(e.toolCallId,e.parentToolCallId);});
 pi.registerTool({name:'mcp__t3-code__delegate_task',label:'Native',description:'Native fixture',parameters:{type:'object',properties:{task:{type:'string'}},required:['task'],additionalProperties:true},async execute(id,args){
 const r=await fetch(${JSON.stringify(base + '/delegate')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...args,parentToolCallId:parents.get(id)})});if(!r.ok)throw new Error('Native fixture refused');const task=await r.json();return {content:[{type:'text',text:JSON.stringify(task)}],structuredContent:{content:[{type:'text',text:JSON.stringify(task)}],structuredContent:task},details:{}};
 }});
}`);
try {
  const root = start('root'); await root.command('get_state');
  let suspension;
  if (scenario === 'question-suspended') {
    suspension = root.command('prompt', { message: '/fixture-suspend' });
    await until(() => existsSync(join(suspensionDir, 'state.json')) && JSON.parse(readFileSync(join(suspensionDir, 'state.json'), 'utf8')).leases.length === 1, 'actual team suspension');
  }
  await root.command('prompt', { message: 'ROOT_COORDINATOR_GOAL' });
  await until(() => clients.has('coordinator') || requests.some(r => JSON.stringify(r).includes('only local Pi leaf profiles')), 'coordinator launch or explicit refusal');
  assert(clients.has('coordinator'), 'native root must launch the permitted coordinator profile, not reject it as a non-leaf');
  if (scenario.startsWith('question')) {
    await until(() => nativeQuestion || requests.some(r => JSON.stringify(r).includes('Tool ask_question not found')), 'native input request or missing-tool refusal');
    assert(nativeQuestion, 'ask_question must create a native user-input request even with team messaging OFF');
  }
  let metadataBoundary;
  if (scenario === 'metadata') {
    await until(() => deferredLeafPrompt && existsSync(join(work, 'coordinator-coordinator', 'before-settle')), 'coordinator holds while leaf remains pending');
    const coordinator = clients.get('coordinator');
    await coordinator.command('set_model', { provider: 'fixture', modelId: 'selected' });
    await coordinator.command('set_thinking_level', { level: 'high' });
    const acknowledged = (await coordinator.command('get_state')).data;
    assert.equal(acknowledged.model.id, 'selected'); assert.equal(acknowledged.thinkingLevel, 'high');
    metadataBoundary = requests.length;
    void deferredLeafPrompt();
  }
  if (scenario === 'launch-lock') {
    await until(() => requests.some(r => JSON.stringify(r.messages).includes('Team state busy; routing stopped.')), 'real post-delegate registration failure reaches the model');
    await until(() => ['failed','cancelled'].includes(tasks.get('task-leaf')?.status), 'native child is terminal after admission failure');
    await until(() => clients.get('coordinator').records.some(e => e.type === 'agent_settled'), 'coordinator must settle after failed registration and terminal cleanup');
    assert.equal(clients.get('coordinator').records.find(e => e.type === 'agent_settled').aborted, false);
    assert.equal(launchCancellationCalls, 1, 'cleanup uses native cancellation for the successful delegation receipt');
    const entries = readFileSync(join(work, 'coordinator-coordinator', 'session.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const failure = entries.find(e => e.message?.toolName === 'subagent' && e.message.isError);
    assert.equal(failure?.message.details?.taskId, 'task-leaf', 'failed launch preserves the native receipt for the caller');
    assert(!requests.some(r => JSON.stringify(r.messages).includes('BOUND_LEAF_PROFILE')), 'unbound failed child never infers');
    assert(!JSON.parse(readFileSync(join(suspensionDir, 'state.json'), 'utf8')).members['leaf-thread']);
  } else if (scenario === 'abort') {
    await until(() => requests.some(r => JSON.stringify(r.messages).includes('BOUND_COORDINATOR_PROFILE') && JSON.stringify(r.messages).includes('COORDINATOR_PING')) && requests.some(r => !JSON.stringify(r.messages).includes('BOUND_COORDINATOR_PROFILE') && !JSON.stringify(r.messages).includes('BOUND_LEAF_PROFILE') && JSON.stringify(r.messages).includes('COORDINATOR_PING')), 'real peer input and root audit are processed before measuring idle hold');
    const before = requests.length;
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(requests.length, before, 'holding for work does not produce keepalive model calls');
    const started = Date.now();
    await clients.get('coordinator').command('abort');
    await until(() => clients.get('coordinator').records.some(e => e.type === 'agent_settled'), 'held coordinator abort');
    assert(Date.now() - started < 2000, 'abort promptly releases the hold');
    assert.equal(clients.get('coordinator').records.find(e => e.type === 'agent_settled').aborted, true);
    await clients.get('leaf').command('abort');
  } else {
    await until(() => clients.get('coordinator').records.some(e => e.type === 'agent_settled'), 'coordinator synthesis and settlement');
    assert(replied && nativeWake, 'held coordinator must process peer input and native completion');
    assert.equal(clients.get('coordinator').records.filter(e => e.type === 'agent_settled').length, 1, 'coordinator settles only after descendants and synthesis');
    assert.equal(tasks.get('task-leaf').status, 'completed');
    const entries = readFileSync(join(work, 'coordinator-coordinator', 'session.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const corrections = entries.filter(e => e.type === 'custom_message' && e.customType === 't3-result-obligation');
    if (['inline-correction', 'decline', 'status-error', 'status-wrong-run', 'status-malformed'].includes(scenario)) assert.equal(corrections.length, 1, 'one actionable correction, never a repeated keepalive');
    if (['decline', 'status-error', 'status-wrong-run', 'status-malformed'].includes(scenario)) {
      if (scenario === 'decline') assert.equal(synthesized, false);
      assert.equal(clients.get('coordinator').records.find(e => e.type === 'agent_settled').aborted, true, 'refusal is an honest native interruption');
      assert.equal(tasks.get('task-coordinator').status, 'interrupted');
      assert(entries.some(e => e.customType === 't3-coordinator-failure'), 'failure is visible in saved history');
    } else {
      assert(synthesized, 'successful coordinator consumes results before final synthesis');
      assert.equal(clients.get('coordinator').records.find(e => e.type === 'agent_settled').aborted, false, 'successful result consumption must not interrupt the coordinator');
      assert.equal(tasks.get('task-coordinator').status, 'completed');
    }
    if (scenario.startsWith('question')) {
      assert.equal(nativeAnswers.length, 1);
      assert.equal(nativeAnswers[0].requestId, 'native-question-1');
      if (scenario === 'question-permission') {
        assert(permissionAttempted && duplicateAnswerAttempted);
        assert(requests.some(r => JSON.stringify(r.messages).includes('permission requests and stale answers cannot be sent')), 'a permission request ID never becomes an answer');
        assert.equal(tasks.size, 2, 'a stale question response cannot create a new assignment');
      }
      if (scenario === 'question-suspended') {
        assert.equal(JSON.parse(readFileSync(join(suspensionDir, 'state.json'), 'utf8')).leases.length, 1, 'questions do not lift arena suspension');
        await root.command('prompt', { message: '/fixture-release' }); await suspension;
        assert.equal(JSON.parse(readFileSync(join(suspensionDir, 'state.json'), 'utf8')).leases.length, 0);
      }
      assert(requests.some(r => JSON.stringify(r.messages).includes('BOUND_LEAF_PROFILE') && JSON.stringify(r.messages).includes('ANSWER_TEXT')), 'native answer reaches the actual child provider');
    }
    if (scenario === 'metadata') {
      const later = requests.slice(metadataBoundary).filter(r => JSON.stringify(r.messages).includes('BOUND_COORDINATOR_PROFILE'));
      assert(later.length > 0);
      for (const request of later) { assert.equal(request.model, 'selected', 'every subsequent provider request honors acknowledged native selection'); assert.equal(request.reasoning_effort, 'high'); }
      assert.equal(entries.filter(e => e.type === 'model_change').at(-1)?.modelId, 'selected', 'saved model selection agrees with provider');
      assert.equal(entries.filter(e => e.type === 'thinking_level_change').at(-1)?.thinkingLevel, 'high', 'saved thinking agrees with provider');
    }
  }
  console.log(`PASS native coordinator ${scenario}: queued-input release, owned obligations and bounded settlement`);
} finally {
  releaseLaunchLock();
  for (const { proc } of clients.values()) proc.stdin.end();
  await Promise.all([...clients.values()].map(({ proc }) => new Promise(resolve => { if (proc.exitCode !== null) return resolve(); proc.once('exit', resolve); setTimeout(() => proc.kill('SIGKILL'), 1500).unref(); })));
  await new Promise(resolve => server.close(resolve));
}

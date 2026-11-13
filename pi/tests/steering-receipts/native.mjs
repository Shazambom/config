// Real Pi RPC processes and TeamStore; native T3 orchestration is a loopback fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [source, cli, work, scenario] = process.argv.slice(2);
assert(['positive','drop','oldrun','fast','notice-error'].includes(scenario));
const processes = [], requests = [], permissionCalls = [], steeringCalls = [], mcpCalls=[];
let fixtureFailure, passed=false;
const parentRequests=[],childRequests=[];let pendingRoot,pendingChild;
const message='NATIVE_ORIGINAL_MULTILINE\nPreserve both original tool results.';
const text=m=>typeof m.content==='string'?m.content:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
function respond(res,calls=[],content='ORIGINAL_WORK_COMPLETE'){
 const delta=calls.length?{role:'assistant',tool_calls:calls.map(([id,name,args],index)=>({index,id,type:'function',function:{name,arguments:JSON.stringify(args)}}))}:{role:'assistant',content};
 res.writeHead(200,{'content-type':'text/event-stream'});
 for(const [d,finish_reason]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:d,finish_reason}]})+'\n\n');
 res.end('data: [DONE]\n\n');
}
let child, childTerminal = false, publishTerminal = false;
const task = { taskId: 'task-1', childThreadId: 'leaf-thread', childRunId: 'leaf-run', status: 'running' };
let base;
const server = createServer(async (req, res) => {
  try {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    if (req.url === '/v1/chat/completions') {
      requests.push(body);
      appendFileSync(join(work, 'leaf-provider.jsonl'), JSON.stringify(body) + '\n');
      const transcript = JSON.stringify(body.messages);
      const leaf = transcript.includes('BOUND_LEAF_PROFILE');
      const list=leaf?childRequests:parentRequests,number=list.push(body);
      writeFileSync(join(work,(leaf?'child':'parent')+'-provider-'+number+'.json'),JSON.stringify(body,null,2));
      if(!leaf&&number===1)respond(res,[['launch','subagent',{agent:'proof-leaf',name:'tester',task:'CHILD_NATIVE_TASK'}]]);
      else if(!leaf&&number===2)pendingRoot=res;
      else if(leaf&&number===1)respond(res,[['first','held_first',{}],['second','held_second',{}]]);
      else if(leaf&&number===2)pendingChild=res;
      else respond(res);
      return;
    }
    if (req.url === '/steer') {
      steeringCalls.push(body);
      assert.equal(body.threadId, 'leaf-thread'); assert.equal(body.mode, 'steer'); assert(body.parentToolCallId);
      let delivered=body.message;
      if(scenario==='oldrun'&&delivered.startsWith('SUBAGENT_MESSAGE_V1:')){
       const envelope=JSON.parse(delivered.slice('SUBAGENT_MESSAGE_V1:'.length));
       const assignment=JSON.parse(envelope.assignmentId);assignment[3]='obsolete-run';envelope.assignmentId=JSON.stringify(assignment);
       delivered='SUBAGENT_MESSAGE_V1:'+JSON.stringify(envelope);
      }
      if(scenario!=='drop')await child.command('prompt', { message: delivered, streamingBehavior: 'steer' });
      if(scenario==='fast'){
       writeFileSync(join(work,'child-release'),'release');
       await until(()=>pendingChild,'fast child continuation');respond(pendingChild);pendingChild=undefined;
       await until(()=>childTerminal,'fast child settlement before native send result');
       publishTerminal=true;
       const stateFile=join(process.env.HOME,'.pi/t3-teams/teams',createHash('sha256').update('root-thread').digest('hex'),'state.json');
       await until(()=>JSON.parse(readFileSync(stateFile)).members['leaf-thread'].live===false,'exact child native assignment retires before send response');
       writeFileSync(join(work,'ack-before-native-result.json'),JSON.stringify({parentRequests:parentRequests.length,childRequests:childRequests.length,childTerminal,childAssignmentRetired:true}));
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ threadId: 'leaf-thread', runId: 'leaf-run', delivery: 'steered', status: 'running' })); return;
    }
    if (req.url === '/delegate') {
      permissionCalls.push(body);
      assert.equal(body.native, 'mcp__t3-code__delegate_task');
      assert(body.parentToolCallId, 'native launch must have a real nested call parent');
      assert.equal(permissionCalls.length,1,'exactly one native assignment');
      child = start('leaf', task.childThreadId);
      await child.command('get_state');
      await child.command('get_entries');
      await child.command('set_model', { provider: 'fixture', modelId: 'fixture' });
      await child.command('set_thinking_level', { level: 'medium' });
      await child.command('set_session_name', { name: 'Native leaf' });
      void child.command('prompt', { message: body.task }).catch(error=>{fixtureFailure=error;});
      // Delay the parent result so the child enters its admission gate first.
      await new Promise(resolve => setTimeout(resolve, 200));
      if (permissionCalls.length === 1) assert(!requests.some(r => JSON.stringify(r).includes('BOUND_LEAF_PROFILE')), 'binding race does not permit early inference');
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(task)); return;
    }
    assert.equal(req.url,'/mcp');
    const id = String(req.headers.authorization).replace('Bearer synthetic-', '');
    assert(['root-thread', 'leaf-thread'].includes(id));
    const run = 'leaf-run';
    let result;
    if (body.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 't3-fixture', version: '1' } };
    else if (body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    else {
      assert(['t3_thread_list', 't3_thread_read', 't3_thread_wait'].includes(body.params.name), 'receipts never inspect output with task_status');
      if(body.params.name==='t3_thread_read')assert.equal(body.params.arguments.threadId,id,'identity reads target self, not child output');
      if (body.params.name === 't3_thread_wait') {
        assert(id.startsWith('leaf-thread'), 'terminal observation must use child credentials');
        assert.equal(body.params.arguments.threadId, id, 'wait must target self');
        assert.equal(body.params.arguments.runId, run, 'wait must target exact bound run');
      }
      mcpCalls.push({caller:id,name:body.params.name,args:body.params.arguments});
      const data = body.params.name === 't3_thread_list' ? { currentThreadId: id, threads: [] }
        : body.params.name === 't3_thread_wait' ? { threadId: id, runId: run, status: publishTerminal ? 'completed' : 'running', timedOut: !publishTerminal }
        : { thread: { threadId: id, parentThreadId: id === 'root-thread' ? null : 'root-thread', activeRunId: id === 'root-thread' ? 'root-run' : run, latestRunId: id === 'root-thread' ? 'root-run' : run, providerInstanceId: 'pi-local' }, recentRuns: [] };
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  } catch (error) { fixtureFailure=error; res.writeHead(500); res.end(JSON.stringify({ error: String(error) })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${server.address().port}`;
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions', apiKey: 'synthetic', baseUrl: `${base}/v1`, models: [{ id: 'fixture', input: ['text'], contextWindow: 100000, maxTokens: 1000 }] } } }));
mkdirSync(join(process.env.PI_CODING_AGENT_DIR, 'agents'), { recursive: true });
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'settings.json'),JSON.stringify({defaultProvider:'fixture',defaultModel:'fixture',retry:{enabled:false},compaction:{enabled:false},cacheWarming:'off',defaultProjectTrust:'always',packages:[]}));
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'agents/proof-leaf.md'),'---\nname: proof-leaf\ndescription: Held native receipt fixture\ntools: held_first, held_second\nsystem-prompt: append\n---\nBOUND_LEAF_PROFILE\n');
const native = join(work, 'native.ts');
writeFileSync(native, `import {writeFileSync,appendFileSync,existsSync,watch} from 'node:fs';
export default function(pi) {
  for(const name of ['held_first','held_second'])pi.registerTool({name,label:name,description:'Private held native child tool',executionMode:'parallel',parameters:{type:'object',properties:{}},async execute(id,args,signal){
   appendFileSync(${JSON.stringify(join(work,'tool-events.jsonl'))},JSON.stringify({type:'enter',name})+'\\n');
   await new Promise((resolve,reject)=>{const watcher=watch(${JSON.stringify(work)},check);const timer=setTimeout(()=>{watcher.close();reject(Error('barrier deadline'));},25000);function check(){if(existsSync(${JSON.stringify(join(work,'child-release'))})){clearTimeout(timer);watcher.close();resolve();}}check();});
   appendFileSync(${JSON.stringify(join(work,'tool-events.jsonl'))},JSON.stringify({type:'exit',name})+'\\n');
   return {content:[{type:'text',text:name+'_RESULT'}],details:{}};
  }});
  const parents = new Map();
  pi.registerTool({name:'mcp__t3-code__t3_thread_send',label:'Native steer fixture',description:'Steer active thread',parameters:{type:'object',properties:{},additionalProperties:true},async execute(id,args){const response=await fetch(${JSON.stringify(base + '/steer')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...args,parentToolCallId:parents.get(id)})});if(!response.ok)throw new Error('native steer refused');const data=await response.json();return {content:[{type:'text',text:JSON.stringify(data)}],details:{}};}});
  pi.on('tool_call', event => { if(event.toolName.startsWith('mcp__t3-code__')) parents.set(event.toolCallId,event.parentToolCallId); });
  pi.registerTool({name:'mcp__t3-code__delegate_task',label:'Native fixture',description:'Native T3 fixture',parameters:{type:'object',properties:{task:{type:'string'}},required:['task'],additionalProperties:true},async execute(id,args){
    const response=await fetch(${JSON.stringify(base + '/delegate')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({native:'mcp__t3-code__delegate_task',parentToolCallId:parents.get(id),...args})});
    if(!response.ok) throw new Error(await response.text());
    const task=await response.json();
    return {content:[{type:'text',text:JSON.stringify(task)}],structuredContent:{content:[{type:'text',text:JSON.stringify(task)}],structuredContent:task},details:{}};
  }});
}`);
const wrapper=join(work,'receipt-wrapper.ts');
if(scenario==='notice-error')writeFileSync(wrapper,`import install from ${JSON.stringify(join(source,'pi-extension/subagents/index.ts'))};import {appendFileSync} from 'node:fs';export default function(pi){let failed=false;install({...pi,sendMessage(message,options){if(message.customType==='subagent-message-received'){appendFileSync(${JSON.stringify(join(work,'notice-attempts.jsonl'))},JSON.stringify({failed:!failed})+'\\n');if(!failed){failed=true;throw Error('INJECTED_NATIVE_NOTICE_ERROR');}}return pi.sendMessage(message,options);}});}`);
function start(label, thread) {
  const cwd = join(work, label); mkdirSync(cwd, { recursive: true });
  const proc = spawn(process.execPath, [cli, '--offline', '--mode', 'rpc', '--no-extensions', '--no-skills', '--no-prompt-templates', '--provider', 'fixture', '--model', 'fixture', '--session', join(cwd, 'session.jsonl'), '-e', scenario==='notice-error'&&label==='root'?wrapper:join(source, 'pi-extension/subagents/index.ts'), '-e', native, '--t3'], { cwd, env: { ...process.env, T3_MCP_URL: `${base}/mcp`, T3_MCP_BEARER_TOKEN: `synthetic-${thread}` }, stdio: ['pipe', 'pipe', 'pipe'] });
  processes.push(proc); const records = []; let buffer = '', next = 0;
  proc.stdout.on('data', chunk => {
    appendFileSync(join(cwd, 'stdout.jsonl'), chunk); buffer += chunk;
    for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break; const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (line.trim()) { const event = JSON.parse(line); records.push(event); if (label === 'leaf' && event.type === 'agent_settled') childTerminal = true; } }
  });
  proc.stderr.on('data', chunk => appendFileSync(join(cwd, 'stderr.txt'), chunk));
  async function command(type, fields = {}, success = true) {
    const id = String(++next); proc.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
    const response = await until(() => records.find(r => r.id === id), `${label} ${type}`);
    assert.equal(response.success, success, JSON.stringify(response)); return response;
  }
  return { proc, records, command };
}
async function until(check, label) {
  const deadline = Date.now() + 20000;
  for (;;) { if(fixtureFailure)throw fixtureFailure; const value = check(); if (value) return value; assert(Date.now() < deadline, `${label} timed out; inspect ${work}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
try {
 const root=start('root','root-thread');await root.command('get_state');await root.command('prompt',{message:'ROOT_LAUNCH'});
 await until(()=>pendingRoot&&existsSync(join(work,'tool-events.jsonl'))&&readFileSync(join(work,'tool-events.jsonl'),'utf8').trim().split('\n').filter(Boolean).length===2,'bound child held in both original tools');
 const dir=join(process.env.HOME,'.pi/t3-teams/teams',createHash('sha256').update('root-thread').digest('hex'));
 const state=()=>JSON.parse(readFileSync(join(dir,'state.json')));assert.equal(state().desired,false,'team OFF');
 respond(pendingRoot,[['steer','subagent_message',{name:'tester',message}]]);pendingRoot=undefined;
 await until(()=>parentRequests.length>=3,'native send result reaches actual parent provider');
 const sent=parentRequests[2].messages.filter(m=>m.role==='tool'&&m.tool_call_id==='steer').map(text).join('');
 const id=sent.match(/^Sent message ([a-f0-9]{12}) to tester\.$/)?.[1],notice=id?'tester received message '+id+'.':undefined;
 if(id&&['positive','notice-error'].includes(scenario)){
  await until(()=>parentRequests.some(r=>r.messages.some(m=>m.role==='user'&&text(m)===notice)),'Pi-input receipt reaches actual parent provider');
  assert.equal(childRequests.length,1);assert(!readFileSync(join(work,'tool-events.jsonl'),'utf8').includes('"type":"exit"'));
  writeFileSync(join(work,'held-proof.json'),JSON.stringify({childRequests:1,toolExits:0,notice}));
 }
 if(scenario!=='fast'){
  writeFileSync(join(work,'child-release'),'release');await until(()=>pendingChild,'child original tool results reach provider');respond(pendingChild);pendingChild=undefined;
 }
 await until(()=>childTerminal,'child settles original work');
 if(id&&scenario==='fast')await until(()=>parentRequests.some(r=>r.messages.some(m=>m.role==='user'&&text(m)===notice)),'receipt after fast child completion and native send response');
 assert(id,'immediate Sent-with-ID, not host acceptance alone');
 const saved=readFileSync(join(work,'root/session.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const notices=saved.filter(e=>e.type==='custom_message'&&e.customType==='subagent-message-received'&&e.content===notice);
 assert.equal(notices.length,['positive','fast','notice-error'].includes(scenario)?1:0);
 if(scenario==='notice-error'){
  const attempts=readFileSync(join(work,'notice-attempts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(attempts.length,2);
  assert(readFileSync(join(work,'root/stderr.txt'),'utf8').includes('INJECTED_NATIVE_NOTICE_ERROR'),'notice failure reported without stopping timer or task');
 }
 assert.equal(childRequests.length,2,'receipt adds no recipient provider turn');
 if(scenario!=='drop')assert(childRequests[1].messages.some(m=>m.role==='user'&&text(m)===message),'full original multiline instruction preserved');
 for(const name of ['held_first','held_second'])assert(childRequests[1].messages.some(m=>m.role==='tool'&&text(m)===name+'_RESULT'));
 assert(!mcpCalls.some(c=>c.caller==='root-thread'&&(c.name==='task_status'||c.name==='t3_thread_read'&&c.args.threadId==='leaf-thread')),'receipt never consumes child output through parent credentials');
 writeFileSync(join(work,'native-result.json'),JSON.stringify({scenario,controlledHost:true,realT3Backend:false,sent,notices:notices.length,parentRequests:parentRequests.length,childRequests:childRequests.length},null,2));
 passed=true;
 console.log('PASS controlled native receipt '+scenario);

} finally {
  pendingRoot?.destroy();pendingChild?.destroy();
  writeFileSync(join(work,'native-calls.json'),JSON.stringify({steeringCalls,mcpCalls},null,2));
  for (const proc of processes) proc.stdin.end();
  await Promise.all(processes.map(proc => new Promise(resolve => { if (proc.exitCode !== null) return resolve(); proc.once('exit', resolve); setTimeout(() => proc.kill('SIGKILL'), 1000).unref(); })));
  server.closeAllConnections();await new Promise(resolve => server.close(resolve));
  const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
  const cleanup={processes:processes.map(p=>({pid:p.pid,code:p.exitCode,signal:p.signalCode,alive:alive(p.pid)})),httpClosed:!server.listening};writeFileSync(join(work,'cleanup.json'),JSON.stringify(cleanup,null,2));assert(cleanup.httpClosed&&cleanup.processes.every(p=>!p.alive));
  if(passed)assert(cleanup.processes.every(p=>p.code===0),'normal native shutdown, not watchdog kill');
}

// Same native thread/history, new exact task/run/member authority. Real Pi RPC.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [source, cli, work, scenario = 'resume-retained'] = process.argv.slice(2);
const shipped = scenario === 'resume-shipped';
const profileName = shipped ? 'scout' : 'proof-leaf';
const profileMarker = shipped ? 'Explore only the assigned question.' : 'RESUME_PROFILE';
const processes = [], requests = [], nativeErrors = [];
let unexpectedDenied = false, staleAnswerIssued = false, forkProbeIssued = false;
const tasks = new Map([['task-1',{taskId:'task-1',childThreadId:'child-thread',childRunId:'child-run-1',status:'running'}]]);
let base, child, delegateCalls=0, queueCalls=0, activeRun='child-run-1', rootLaunched=false, followupIssued=false, followupCommand;
const nativeKeys=new Map();
async function until(check,label){const end=Date.now()+15000;for(;;){const value=check();if(value)return value;assert(Date.now()<end,`${label}; inspect ${work}`);await new Promise(r=>setTimeout(r,10));}}
function start(role,restore=false){
 const cwd=join(work,role);mkdirSync(cwd,{recursive:true});
 const args=['--mode','rpc','--no-extensions','--no-skills','--no-prompt-templates','--provider','fixture','--model','fixture',...(restore?[]:['--session',join(cwd,'session.jsonl')]),'-e',fileURLToPath(new URL('../../agent/lifecycle/session-lifecycle.ts',import.meta.url)),'-e',join(source,'pi-extension/subagents/index.ts'),'-e',join(work,'resume-native.ts'),'--t3','--team'];
 const proc=spawn(cli,args,{cwd,env:{...process.env,T3_MCP_URL:`${base}/mcp`,T3_MCP_BEARER_TOKEN:role==='root'?'synthetic-root':'synthetic-child'},stdio:['pipe','pipe','pipe']});processes.push(proc);
 const records=[];let sequence=0,buffer='';
 proc.stdout.on('data',chunk=>{appendFileSync(join(cwd,'stdout.jsonl'),chunk);buffer+=chunk;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;const event=JSON.parse(line);records.push(event);if(role!=='root'&&event.type==='agent_settled'){const task=[...tasks.values()].find(t=>t.childRunId===activeRun);if(task)task.status=event.aborted?'interrupted':'completed';}}});
 proc.stderr.on('data',chunk=>appendFileSync(join(cwd,'stderr.txt'),chunk));
 async function command(type,fields={}){const id=String(++sequence);proc.stdin.write(JSON.stringify({id,type,...fields})+'\n');const result=await until(()=>records.find(r=>r.id===id),`${role} ${type}`);if(!result.success)throw new Error(result.error);return result;}
 return{proc,records,command};
}
const server=createServer(async(req,res)=>{try{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
 if(req.url==='/v1/chat/completions'){
  requests.push(body);appendFileSync(join(work,'resume-provider.jsonl'),JSON.stringify(body)+'\n');const transcript=JSON.stringify(body.messages);const leaf=transcript.includes(profileMarker);let name,args,output='ROOT_IDLE';
  if(leaf){if(transcript.includes('FOLLOWUP_CONTEXT_TASK')){assert(transcript.includes('ORIGINAL_CONTEXT_VALUE')&&transcript.includes('ORIGINAL_RESULT'),'followup must retain actual original conversation');output='FOLLOWUP_RESULT';}else output='ORIGINAL_RESULT';}
  else if(!rootLaunched){
   rootLaunched=true;name='subagent';args={agent:profileName,name:'peer',task:'Remember ORIGINAL_CONTEXT_VALUE and answer ORIGINAL_RESULT.'};
   if(shipped&&!forkProbeIssued){forkProbeIssued=true;rootLaunched=false;args.fork=true;}
   else if(shipped){assert.equal(delegateCalls,0,'fork refused before native delegation');assert.match(transcript,/only local Pi profiles/,'explicit fork remains refused');}
  }
  else if(!followupIssued&&transcript.includes('RESUME_REQUEST')){followupIssued=true;name='subagent_message';args={name:'peer',message:'FOLLOWUP_CONTEXT_TASK: use what I told you before and finish.'};}
  else if(!staleAnswerIssued&&transcript.includes('STALE_ANSWER')){staleAnswerIssued=true;name='subagent_message';args={name:'peer',requestId:'old-question-id',message:'OLD_ANSWER_MUST_NOT_RUN'};}
  const delta=name?{role:'assistant',tool_calls:[{index:0,id:`resume-call-${requests.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:output};
  res.writeHead(200,{'content-type':'text/event-stream'});for(const[part,finish_reason]of[[delta,null],[{},name?'tool_calls':'stop']])res.write(`data: ${JSON.stringify({id:`req-${requests.length}`,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:part,finish_reason}]})}\n\n`);res.end('data: [DONE]\n\n');return;
 }
 if(req.url==='/native'){
  assert(body.parentToolCallId,'all native mutation uses nested tool permission pipeline');
  if(body.tool==='delegate_task'){
   delegateCalls++;if(delegateCalls>1){res.writeHead(409);res.end('Same-thread resume must not create a fresh child.');return;}
   child=start('child');await child.command('get_entries');void child.command('prompt',{message:body.args.task}).catch(e=>nativeErrors.push(String(e)));await new Promise(r=>setTimeout(r,100));
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(tasks.get('task-1')));return;
  }
  if(body.tool==='task_status'){
   const task=tasks.get(body.args.taskId);assert(task);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({...task,summary:task.taskId==='task-1'?'ORIGINAL_RESULT':'FOLLOWUP_RESULT'}));return;
  }
  if(body.tool==='t3_thread_send'){
   queueCalls++;assert.equal(body.args.mode,'queue','completed assignments never use auto/steer fallback');assert.equal(body.args.threadId,'child-thread');
   if(scenario==='resume-failure'){res.writeHead(409);res.end('Synthetic native queue refusal.');return;}
   let task=nativeKeys.get(body.args.clientRequestId);
   if(!task){task={taskId:'task-2',childThreadId:'child-thread',childRunId:'child-run-2',status:'running'};tasks.set(task.taskId,task);nativeKeys.set(body.args.clientRequestId,task);activeRun=task.childRunId;
    if(scenario==='resume-replaced'){
     child.proc.stdin.end();await until(()=>child.proc.exitCode===0,'native owner releases old provider');child=start('child-replaced',true);
     await child.command('get_state');await child.command('switch_session',{sessionPath:join(work,'child','session.jsonl')});await child.command('get_entries');
    }
    if(scenario==='resume-active-race'){
     activeRun='unexpected-run';
     followupCommand=child.command('prompt',{message:'UNAUTHORIZED_UNEXPECTED_TASK'}).then(()=>{throw new Error('Unexpected native run was admitted');},()=>{unexpectedDenied=true;activeRun='child-run-2';return child.command('prompt',{message:body.args.message});}).catch(e=>nativeErrors.push(String(e)));
    }else followupCommand=child.command('prompt',{message:body.args.message}).catch(e=>nativeErrors.push(String(e)));
    if(['resume-lost-response','resume-cancel','resume-wrong-binding'].includes(scenario))void child.command('compact').catch(e=>nativeErrors.push(String(e)));
   }
   await new Promise(r=>setTimeout(r,150));
   assert(!requests.some(r=>JSON.stringify(r.messages).includes(profileMarker)&&JSON.stringify(r.messages).includes('FOLLOWUP_CONTEXT_TASK')),'queued request cannot infer before the returned exact binding is published');
   if(scenario==='resume-lost-response'){res.destroy();return;}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({threadId:'child-thread',runId:scenario==='resume-wrong-binding'?'child-run-1':task.childRunId,taskId:scenario==='resume-wrong-binding'?'task-1':task.taskId,delivery:'queued',status:task.status,messageId:'followup-message'}));return;
  }
  throw new Error('Unexpected native mutation');
 }
 const role=req.headers.authorization==='Bearer synthetic-root'?'root':'child';let result;
 if(body.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 else if(body.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
 else{let data;
  if(body.params.name==='t3_thread_list')data={currentThreadId:`${role}-thread`,threads:[]};
  else if(body.params.name==='t3_thread_read')data={thread:{threadId:`${role}-thread`,parentThreadId:role==='root'?null:'root-thread',activeRunId:role==='root'?'root-run':activeRun,latestRunId:role==='root'?'root-run':activeRun,providerInstanceId:'pi-local',model:'fixture/fixture'},recentRuns:[]};
  else if(body.params.name==='t3_thread_wait'){const task=[...tasks.values()].find(t=>t.childRunId===body.params.arguments.runId);assert(task);data={threadId:'child-thread',runId:scenario==='resume-stale-completion'&&task.taskId==='task-2'?'child-run-1':task.childRunId,status:task.status,timedOut:task.status==='running'};}
  else throw new Error('Unexpected discovery');result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};
 }
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
}catch(error){appendFileSync(join(work,'resume-errors.txt'),String(error)+'\n');res.writeHead(500);res.end('{}');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',apiKey:'synthetic',baseUrl:`${base}/v1`,models:[{id:'fixture',input:['text'],contextWindow:100000,maxTokens:1000}]}}}));
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));mkdirSync(join(process.env.PI_CODING_AGENT_DIR,'agents'),{recursive:true});
if (shipped) {
 const profile = readFileSync(fileURLToPath(new URL('../../agent/agents/scout.md',import.meta.url)),'utf8');
 assert.match(profile,/session-mode: lineage-only/);
 writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'agents','scout.md'),profile);
} else writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'agents','proof-leaf.md'),'---\nname: proof-leaf\ndescription: Resume proof\ntools: read\nsystem-prompt: append\n---\nRESUME_PROFILE\n');
writeFileSync(join(work,'resume-native.ts'),`export default function(pi){const parents=new Map();pi.on('tool_call',e=>parents.set(e.toolCallId,e.parentToolCallId));for(const tool of ['delegate_task','t3_thread_send','task_status'])pi.registerTool({name:'mcp__t3-code__'+tool,label:tool,description:'Native fixture',parameters:{type:'object',properties:{},additionalProperties:true},async execute(id,args){const r=await fetch(${JSON.stringify(base+'/native')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool,args,parentToolCallId:parents.get(id)})});if(!r.ok)throw new Error(await r.text());let data=await r.json();if(${scenario === 'resume-duplicate'}&&tool==='t3_thread_send'){const retry=await fetch(${JSON.stringify(base+'/native')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool,args,parentToolCallId:parents.get(id)})});data=await retry.json();}return{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data},details:{}};}});}`);
try{
 const root=start('root');await root.command('prompt',{message:'INITIAL_REQUEST PRIVATE_ROOT_CONTEXT_ONLY'});
 const dir=join(process.env.HOME,'.pi','t3-teams','teams',createHash('sha256').update('root-thread').digest('hex'));const state=()=>JSON.parse(readFileSync(join(dir,'state.json'),'utf8'));
 await until(()=>state().members['child-thread']?.live===false&&root.records.some(e=>e.type==='agent_settled'),'first native assignment completes');
 if (shipped) {
  const first = requests.find(r=>JSON.stringify(r.messages).includes(profileMarker));
  assert(first,'actual shipped profile reaches child provider');
  assert(!JSON.stringify(first.messages).includes('PRIVATE_ROOT_CONTEXT_ONLY'),'lineage-only must not copy parent conversation');
  assert(!readFileSync(join(work,'child','session.jsonl'),'utf8').includes('PRIVATE_ROOT_CONTEXT_ONLY'),'saved child session contains no copied parent conversation');
  const bindingPath=join(process.env.HOME,'.pi','t3-teams','bindings',createHash('sha256').update('child-thread').digest('hex')+'.json');
  const binding=JSON.parse(readFileSync(bindingPath,'utf8'));
  assert.equal(binding.parentThreadId,'root-thread','native binding preserves parent lineage');
  assert.equal(binding.childThreadId,'child-thread');
  assert.equal(binding.agent,'scout');
  assert(!first.tools.some(t=>['bash','write','edit','subagent'].includes(t.function.name)),'shipped scout restrictions reach actual provider');
 }
 const original=state().members['child-thread'];const originalPid=child.proc.pid;const before=requests.length;
 await root.command('prompt',{message:'RESUME_REQUEST'});
 if(scenario==='resume-cancel'){
  await until(()=>queueCalls===1,'native queue starts before cancellation');const started=Date.now();await root.command('abort');assert(Date.now()-started<2000,'cancel does not hang behind binding');
  await until(()=>root.records.some(e=>e.type==='agent_settled'&&e.aborted),'honest cancelled parent receipt');
 }else await until(()=>requests.slice(before).filter(r=>!JSON.stringify(r.messages).includes(profileMarker)).length>=2,'resume tool result reaches parent model');
 assert.equal(delegateCalls,1,'resume cannot replace the child with a fresh unrelated conversation');assert.equal(queueCalls,scenario==='resume-duplicate'?2:1,'explicit resume must queue a new run on the same native thread');
 if(['resume-failure','resume-lost-response','resume-cancel','resume-wrong-binding'].includes(scenario)){ 
  if(followupCommand)await followupCommand;
  assert(!requests.some(r=>JSON.stringify(r.messages).includes(profileMarker)&&JSON.stringify(r.messages).includes('FOLLOWUP_CONTEXT_TASK')),'failed/ambiguous queue response grants no inference authority');
  assert.equal(state().members['child-thread'].live,false);assert.equal(Object.values(state().members).filter(m=>m.t3?.taskId==='task-2').length,0,'ambiguous assignment creates no admitted incarnation');
 }else{
  await until(()=>requests.some(r=>JSON.stringify(r.messages).includes(profileMarker)&&JSON.stringify(r.messages).includes('FOLLOWUP_CONTEXT_TASK'))||nativeErrors.length,'followup provider request or admission failure');
  assert.equal(nativeErrors.length,0,JSON.stringify(nativeErrors));await followupCommand;
  const resumed=Object.values(state().members).find(m=>m.t3?.taskId==='task-2');assert(resumed);assert.notEqual(resumed.id,original.id);assert.notEqual(resumed.incarnation,original.incarnation);assert.equal(state().members[original.id].live,false,'old membership stays retired');
  assert.equal(child.proc.pid===originalPid,scenario!=='resume-replaced','only native owner chooses provider retention/replacement');
  if(scenario==='resume-active-race')assert(unexpectedDenied&&!requests.some(r=>JSON.stringify(r.messages).includes(profileMarker)&&JSON.stringify(r.messages).includes('UNAUTHORIZED_UNEXPECTED_TASK')),'unexpected active run cannot borrow queued assignment authority');
  if(scenario==='resume-duplicate')assert.equal(nativeKeys.size,1,'same native idempotency key has one run');
  if(scenario==='resume-stale-completion'){
   await until(()=>Object.values(state().members).find(m=>m.t3?.taskId==='task-2')?.t3.status==='unknown','stale completion is rejected');
   assert.equal(Object.values(state().members).find(m=>m.t3?.taskId==='task-2').live,true,'old run completion cannot retire new incarnation');
  }
  const entries=readFileSync(join(work,'child','session.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.filter(e=>e.message?.role==='user'&&JSON.stringify(e.message.content).includes('FOLLOWUP_CONTEXT_TASK')).length,1,'followup is delivered exactly once into original saved history');
  await until(()=>root.records.filter(e=>e.type==='agent_settled').length>=2,'root finishes followup dispatch');
  await root.command('prompt',{message:'STALE_ANSWER'});
  await until(()=>requests.some(r=>JSON.stringify(r.messages).includes('no answer or new assignment was sent')||JSON.stringify(r.messages).includes('stale answers cannot be sent')),'stale answer refusal');
  assert.equal(queueCalls,scenario==='resume-duplicate'?2:1,'stale answers never authorize another assignment');
  assert(!requests.some(r=>JSON.stringify(r.messages).includes(profileMarker)&&JSON.stringify(r.messages).includes('OLD_ANSWER_MUST_NOT_RUN')));
 }
 console.log(`PASS ${scenario}: same thread/history, exact new binding, independent writer and no peer revival`);
}finally{for(const p of processes)p.stdin.end();await Promise.all(processes.map(p=>new Promise(r=>{if(p.exitCode!==null)return r();p.once('exit',r);setTimeout(()=>p.kill('SIGKILL'),1500).unref();})));server.closeAllConnections();await new Promise(r=>server.close(r));}

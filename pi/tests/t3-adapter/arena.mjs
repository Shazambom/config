// Deterministic native /arena through real command/tool/RPC paths. T3 is a fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [source, cli, work, scenario = 'arena'] = process.argv.slice(2);
const mode = scenario === 'arena-dropout-startup' ? 'arena-dropout' : ['arena-cancel-prestart','arena-cancel-launch'].includes(scenario) ? 'arena-cancel' : scenario;
let fixtureFailure, releasePrestart, launchLockHeld=false;
const launchLockDir=join(process.env.HOME,'.pi','t3-teams','teams',createHash('sha256').update('root-thread').digest('hex'),'lock');
const releaseLaunchLock=()=>{if(launchLockHeld){rmSync(launchLockDir,{recursive:true});launchLockHeld=false;}};
const ownerCancelling = new Set(), cancellationReceipts = [];
const clients = new Map(), tasks = new Map(), requests = [], nativeCalls = [], failedRoles = new Set();
const stages = new Map(); let base, launchedCandidates = false, launchedJudge = false, wroteSynthesis = false, verified = false;
const desired = mode !== 'arena-off';
const artifacts = join(work, 'arena-artifacts'); mkdirSync(artifacts);
const candidate = role => join(artifacts, `${role}.txt`);
async function until(check, label) { const end = Date.now() + 25000; for (;;) { assert(!fixtureFailure, fixtureFailure); const value = check(); if (value) return value; assert(Date.now() < end, `${label} timeout; inspect ${work}`); await new Promise(r => setTimeout(r, 20)); } }
function start(role) {
  const cwd = join(work, role); mkdirSync(cwd, { recursive: true });
  const args = ['--mode','rpc','--no-extensions','--no-prompt-templates','--provider','fixture','--model','fixture','--session',join(cwd,'session.jsonl'),'-e',join(source,'pi-extension/subagents/index.ts'),'-e',join(work,'arena-native.ts'),'--t3'];
  if (desired) args.push('--team');
  const proc = spawn(cli,args,{cwd,env:{...process.env,T3_MCP_URL:`${base}/mcp`,T3_MCP_BEARER_TOKEN:`synthetic-${role}`},stdio:['pipe','pipe','pipe']});
  const records=[]; let buffer='',sequence=0;
  proc.stdout.on('data',chunk=>{appendFileSync(join(cwd,'stdout.jsonl'),chunk);buffer+=chunk;for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;const event=JSON.parse(line);records.push(event);if(event.type==='message_end'&&event.message?.role==='assistant'&&event.message.stopReason==='error')failedRoles.add(role);if(role!=='root'&&event.type==='agent_settled'){const task=tasks.get(`task-${role}`);if(task){task.status=event.aborted?'interrupted':failedRoles.has(role)?'failed':'completed';const parent=clients.get(task.parent);if(parent&&task.parent!=='root'&&mode!=='arena-delayed'&&!ownerCancelling.has(task.taskId)&&!ownerCancelling.has(`task-${task.parent}`))void parent.command('prompt',{message:`Delegated task ${task.taskId} reached a terminal state. Use task_status with taskId ${task.taskId} to read the result.`,streamingBehavior:'steer'}).catch(()=>{});}}}});
  proc.stderr.on('data',chunk=>appendFileSync(join(cwd,'stderr.txt'),chunk));
  let promptSent=false;
  async function command(type,fields={},success=true){const id=String(++sequence);if(type==='prompt')promptSent=true;proc.stdin.write(JSON.stringify({id,type,...fields})+'\n');const response=await until(()=>records.find(r=>r.id===id),`${role} ${type}`);assert.equal(response.success,success,JSON.stringify(response));return response;}
  const client={proc,records,command,get promptSent(){return promptSent;}};clients.set(role,client);return client;
}
const server=createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  if(req.url==='/v1/chat/completions'){
    requests.push(body);appendFileSync(join(work,'arena-provider.jsonl'),JSON.stringify(body)+'\n');
    const transcript=JSON.stringify(body.messages);
    if(scenario==='arena-dropout-startup')assert(!transcript.includes('Owned task is not terminal'),'native terminal startup failure must be consumable without a child admission callback');
    const role=transcript.includes('ARENA_COORDINATOR_PROFILE')?'arena':transcript.includes('ARENA_REVIEWER_PROFILE')?'judge':transcript.includes('CANDIDATE a')?'candidate-a':transcript.includes('CANDIDATE b')?'candidate-b':'root';
    assert.notEqual(role,'root','registered /arena launches without a parent model call');
    assert(!body.tools?.some(t=>t.function.name==='team_send'),'arena suspension removes normal team messaging from every child request');
    const calls=[];let output='Waiting for owned work.';
    const consumed=id=>transcript.includes(`MODEL_VISIBLE_RESULT ${id}`);
    const completed=[...tasks.values()].filter(t=>t.parent===role&&['completed','failed','interrupted'].includes(t.status)&&!consumed(t.taskId));
    if(role==='arena'){
      if(!launchedCandidates){launchedCandidates=true;for(const suffix of ['a','b'])calls.push(['subagent',{agent:'worker',name:`candidate-${suffix}`,task:`CANDIDATE ${suffix}: independently write the artifact and rationale, including rejected alternatives, to ${candidate(`candidate-${suffix}`)}`}]);}
      else if(completed.length){for(const task of completed)calls.push(['mcp__t3-code__task_status',{taskId:task.taskId}]);}
      else if(!launchedJudge&&consumed('task-candidate-a')&&consumed('task-candidate-b')){
        launchedJudge=true;
        for(const role of mode==='arena-dropout'?['candidate-a']:['candidate-a','candidate-b'])calls.push(['read',{path:candidate(role)}]);
        calls.push(['subagent',{agent:'reviewer',name:'judge',task:`CROSS_JUDGE: read ${candidate('candidate-a')}${mode==='arena-dropout'?' (candidate-b dropped out)':` and ${candidate('candidate-b')}`} end to end; score correctness and simplicity, then recommend a base with rationale.`}]);
      }else if(consumed('task-judge')&&!wroteSynthesis){
        wroteSynthesis=true;
        calls.push(['write',{path:join(artifacts,'synthesized.txt'),content:mode==='arena-dropout'?'Base candidate a; keep its verification after candidate-b dropout.\n':'Base candidate a; graft useful verification from candidate b.\n'}]);
        calls.push(['write',{path:join(artifacts,'synthesis.md'),content:mode==='arena-dropout'?'Base: candidate a. Judge agrees. Graft: none with one surviving candidate. Rejected: claiming missing candidate output. Dropouts: candidate-b provider failure. Same fixture model family. Verification: concrete artifact check.\n':'Base: candidate a, simpler boundary. Judge agrees. Graft: verification from b. Rejected: b complexity. Dropouts: none. Same fixture model family. Verification: inspect synthesized artifact and run a concrete content check.\n'}]);
      }else if(wroteSynthesis&&!verified){verified=true;calls.push(['bash',{command:`test -s ${JSON.stringify(join(artifacts,'synthesized.txt'))} && grep -q verification ${JSON.stringify(join(artifacts,'synthesized.txt'))}`}]);}
      else if(verified)output='ARENA_FINAL_SYNTHESIS_VERIFIED';
    }else if(role==='judge'){
      assert(tasks.get('task-candidate-a')?.status==='completed'&&tasks.get('task-candidate-b')?.status===(mode==='arena-dropout'?'failed':'completed'),'cross-judge cannot begin on unfinished candidates');
      if(!stages.has(role)){stages.set(role,1);for(const candidateRole of mode==='arena-dropout'?['candidate-a']:['candidate-a','candidate-b'])calls.push(['read',{path:candidate(candidateRole)}]);}else output='JUDGE_VERDICT: candidate a is the simpler base; graft b verification.';
    }else{
      if(mode==='arena-cancel')return; // Native owner aborts this in-flight provider call.
      if(mode==='arena-dropout'&&role==='candidate-b'){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture candidate dropout',type:'invalid_request_error'}}));return;}
      if(!stages.has(role)){stages.set(role,1);calls.push(['write',{path:candidate(role),content:`Artifact ${role}. Rationale: choose a narrow boundary; reject a broad framework. Verification idea included.\n`}]);}else output=`CANDIDATE_FINAL ${role}`;
    }
    const delta=calls.length?{role:'assistant',tool_calls:calls.map(([name,args],index)=>({index,id:`arena-${requests.length}-${index}`,type:'function',function:{name,arguments:JSON.stringify(args)}}))}:{role:'assistant',content:output};
    res.writeHead(200,{'content-type':'text/event-stream'});for(const [part,finish_reason]of[[delta,null],[{},calls.length?'tool_calls':'stop']])res.write(`data: ${JSON.stringify({id:`req-${requests.length}`,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:part,finish_reason}]})}\n\n`);res.end('data: [DONE]\n\n');return;
  }
  if(req.url==='/native'){
    nativeCalls.push(body);
    if(body.tool==='delegate_task'){
      const role=body.args.task.includes('CANDIDATE a')?'candidate-a':body.args.task.includes('CANDIDATE b')?'candidate-b':body.args.task.includes('CROSS_JUDGE')?'judge':'arena';
      const parent=role==='arena'?'root':'arena';
      assert(body.parentToolCallId,'native delegation always runs through its active wrapper');
      const task={taskId:`task-${role}`,childThreadId:`${role}-thread`,childRunId:`${role}-run`,parent,status:'running',summary:`MODEL_VISIBLE_RESULT task-${role}`};tasks.set(task.taskId,task);
      if(scenario==='arena-dropout-startup'&&role==='candidate-b'){
        setTimeout(()=>{task.status='failed';void clients.get('arena').command('prompt',{message:`Delegated task ${task.taskId} failed before child admission. Use task_status with taskId ${task.taskId}.`,streamingBehavior:'steer'}).catch(()=>{});},100);
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(task));return;
      }
      const child=start(role);await child.command('get_entries');await child.command('set_model',{provider:'fixture',modelId:'fixture'});await child.command('set_thinking_level',{level:'medium'});await child.command('set_session_name',{name:role});
      const prestart=(scenario==='arena-cancel-prestart'&&role==='candidate-b')||(scenario==='arena-cancel-launch'&&role==='arena');
      void child.command('prompt',{message:body.args.task},!prestart).then(response=>{if(!response.success&&!ownerCancelling.has(task.taskId))task.status='failed';}).catch(error=>{fixtureFailure=String(error);appendFileSync(join(work,'arena-errors.txt'),String(error)+'\n');});
      if(scenario==='arena-cancel-prestart'&&prestart)await new Promise(resolve=>{releasePrestart=resolve;});
      if(scenario==='arena-cancel-launch'&&role==='arena'){mkdirSync(launchLockDir);launchLockHeld=true;setTimeout(releaseLaunchLock,3500).unref();}
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(task));return;
    }
    const task=tasks.get(body.args.taskId);assert(task);
    if(body.tool==='task_cancel'){
      releaseLaunchLock();
      const affected=[task,...[...tasks.values()].filter(t=>t.parent===task.childThreadId.replace(/-thread$/,''))];
      for(const t of affected)ownerCancelling.add(t.taskId);
      const stops=affected.map(async t=>{
        const role=t.childThreadId.replace(/-thread$/,''),client=clients.get(role);
        await client.command('abort');
        const receipt=await until(()=>client.records.find(e=>e.type==='agent_settled'&&e.aborted)||client.records.find(e=>e.type==='response'&&e.command==='prompt'&&e.success===false&&/abort/i.test(e.error??'')),'native cancellation receipt');
        if(receipt.type==='agent_settled'){
          assert(client.records.some(e=>e.type==='agent_start'),'started runs have a real start event');
          if(!cancellationReceipts.some(r=>r.role===role))cancellationReceipts.push({role,kind:'started-settled',aborted:receipt.aborted});
        }else{
          assert(!client.records.some(e=>e.type==='agent_start'||e.type==='agent_settled'),'pre-start cancellation never invents settlement');
          const marker=role==='arena'?'ARENA_COORDINATOR_PROFILE':role==='candidate-b'?'CANDIDATE b':'CANDIDATE a';
          assert(!requests.some(r=>JSON.stringify(r.messages).includes(role==='arena'?'ARENA_COORDINATOR_PROFILE':'ARENA_CANDIDATE_PROFILE')&&JSON.stringify(r.messages).includes(marker)),'pre-start cancellation has zero provider requests');
          if(!cancellationReceipts.some(r=>r.role===role))cancellationReceipts.push({role,kind:'prestart-refused',promptFailed:true,abortAcknowledged:true,providerRequests:0});
        }
        t.status='cancelled';
      });
      releasePrestart?.();
      await Promise.all(stops);
      writeFileSync(join(work,'cancellation-receipts.json'),JSON.stringify(cancellationReceipts,null,2));
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(task));return;
  }
  const role=String(req.headers.authorization).replace('Bearer synthetic-','');let result;
  if(body.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
  else if(body.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
  else{let data;const task=tasks.get(`task-${role}`);if(body.params.name==='t3_thread_list')data={currentThreadId:`${role}-thread`,threads:[]};else if(body.params.name==='t3_thread_read')data={thread:{threadId:`${role}-thread`,parentThreadId:role==='root'?null:`${task.parent}-thread`,activeRunId:`${role}-run`,latestRunId:`${role}-run`,providerInstanceId:'pi-local'},recentRuns:[]};else if(body.params.name==='t3_thread_wait'){const target=[...tasks.values()].find(t=>t.childThreadId===body.params.arguments.threadId&&t.childRunId===body.params.arguments.runId);assert(target&&(target.childThreadId===`${role}-thread`||target.parent===role),'non-acknowledging wait is self or owned child only');data={threadId:target.childThreadId,runId:target.childRunId,status:target.status,timedOut:target.status==='running'};}else throw new Error('Unexpected observer tool');result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
}catch(error){fixtureFailure=String(error);appendFileSync(join(work,'arena-errors.txt'),String(error)+'\n');res.writeHead(500);res.end('{}');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',apiKey:'synthetic',baseUrl:`${base}/v1`,models:[{id:'fixture',input:['text'],contextWindow:100000,maxTokens:1000}]}}}));
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
mkdirSync(join(process.env.PI_CODING_AGENT_DIR,'agents'),{recursive:true});
for(const[name,tools,children,marker]of[['arena','read,write,bash','worker,reviewer','ARENA_COORDINATOR_PROFILE'],['worker','read,write','','ARENA_CANDIDATE_PROFILE'],['reviewer','read','','ARENA_REVIEWER_PROFILE']])writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'agents',`${name}.md`),`---\nname: ${name}\ndescription: Arena fixture\ntools: ${tools}\n${children?`subagent_agents: ${children}\n`:''}system-prompt: append\n---\n${marker}\n`);
mkdirSync(join(process.env.PI_CODING_AGENT_DIR,'skills','arena'),{recursive:true});
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'skills','arena','SKILL.md'),'---\nname: arena\ndescription: Native arena phase fixture\n---\nFrame. Fan out fresh independent candidate artifacts and rationales. Read every output. After all candidates finish, cross-judge with one read-only reviewer while reading candidates yourself. Pick a base, graft a useful idea, record rejections and dropouts, and verify the actual synthesized artifact.\n');
writeFileSync(join(work,'arena-native.ts'),`export default function(pi){const parents=new Map();pi.on('tool_call',e=>parents.set(e.toolCallId,e.parentToolCallId));for(const tool of ['delegate_task','task_status','task_cancel'])pi.registerTool({name:'mcp__t3-code__'+tool,label:tool,description:'Native fixture',parameters:{type:'object',properties:{},additionalProperties:true},async execute(id,args){const response=await fetch(${JSON.stringify(base+'/native')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool,args,parentToolCallId:parents.get(id)})});if(!response.ok)throw new Error('native fixture failed');const value=await response.json();return{content:[{type:'text',text:JSON.stringify(value)}],...(tool==='task_status'?{}:{structuredContent:{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value}}),details:{}};}});}`);
try{
  const root=start('root');await root.command('get_state');const run=root.command('prompt',{message:'/arena ARENA_REQUEST'});void run.catch(()=>{});
  const dir=join(process.env.HOME,'.pi','t3-teams','teams',createHash('sha256').update('root-thread').digest('hex'));
  const state=()=>JSON.parse(readFileSync(join(dir,'state.json'),'utf8'));
  if(mode==='arena-cancel'){
    if(scenario==='arena-cancel-launch')await until(()=>launchLockHeld&&clients.get('arena')?.promptSent,'successful native delegate blocked on local registration');
    else if(scenario==='arena-cancel-prestart')await until(()=>releasePrestart&&clients.get('candidate-b')?.promptSent&&clients.get('candidate-a')?.records.some(e=>e.type==='agent_start'),'one candidate started and another blocked before admission');
    else await until(()=>['candidate-a','candidate-b'].every(role=>clients.get(role)?.records.some(e=>e.type==='agent_start')),'both candidates actually started');
    assert.equal(state().leases.length,1,'arena suspends normal messaging while work runs');
    await root.command('prompt',{message:'/arena cancel'});
  }
  await run;
  // Pi keeps command-only entries in memory until the first model message.
  // Read the real RPC entries rather than inventing an assistant to flush them.
  const entries=(await root.command('get_entries')).data.entries;
  const outcome=entries.filter(e=>e.type==='custom'&&e.customType==='arena-outcome').at(-1)?.data;
  assert(outcome,'deterministic command records its actual outcome');
  assert.equal(outcome.status,mode==='arena-cancel'?'cancelled':'finished',JSON.stringify(outcome));
  assert.equal(state().leases.length,0);assert.equal(state().desired,desired,'saved ON/OFF survives native arena');
  if(mode==='arena-cancel'){assert(nativeCalls.some(c=>c.tool==='task_cancel'),'only native cancellation owns descendants');assert([...tasks.values()].every(t=>t.status==='cancelled'));assert.equal(cancellationReceipts.length,scenario==='arena-cancel-launch'?1:3);if(scenario==='arena-cancel-launch'){assert(cancellationReceipts.some(r=>r.role==='arena'&&r.kind==='prestart-refused'));assert(!state().members['arena-thread'],'no failed registration became deliverable');const receipt=root.records.find(e=>e.type==='tool_execution_end'&&e.toolName==='subagent'&&e.result?.details?.launchFailed);assert.equal(receipt?.result.details.taskId,'task-arena','native receipt survives the cancelled launch');}else if(scenario==='arena-cancel-prestart')assert(cancellationReceipts.some(r=>r.role==='candidate-b'&&r.kind==='prestart-refused'));else assert(cancellationReceipts.every(r=>r.kind==='started-settled'));}
  else{
    assert.equal(nativeCalls.filter(c=>c.tool==='delegate_task').length,4,'arena coordinator, two independent candidates and one cross-judge');
    assert(existsSync(candidate('candidate-a')));
    assert.equal(existsSync(candidate('candidate-b')),mode!=='arena-dropout');
    assert(readFileSync(join(artifacts,'synthesized.txt'),'utf8').includes(mode==='arena-dropout'?'dropout':'graft'));
    if(mode==='arena-dropout')assert(readFileSync(join(artifacts,'synthesis.md'),'utf8').includes('Dropouts: candidate-b provider failure'));
    if(scenario==='arena-dropout-startup'){assert(!clients.has('candidate-b'));assert.equal(state().members['candidate-b-thread'].t3.claimed,false);assert.equal(state().members['candidate-b-thread'].t3.status,'failed');}
    assert(readFileSync(join(artifacts,'synthesis.md'),'utf8').includes('Rejected:'));
    assert(verified,'actual artifact verification tool ran before final synthesis');
    assert.equal(clients.get('arena').records.filter(e=>e.type==='agent_settled').length,1,'candidate work and cross-judge do not retire the coordinator early');
    if(mode==='arena-delayed'){
      const coordinatorEntries=readFileSync(join(work,'arena','session.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
      const corrections=coordinatorEntries.filter(e=>e.customType==='t3-result-obligation');
      assert.equal(corrections.length,2,'each new terminal cohort gets its own single actionable correction when native notification is delayed');
      for(const id of ['task-candidate-a','task-candidate-b','task-judge'])assert.equal(corrections.filter(e=>String(e.content).includes(id)).length,1,'no repeated correction for the same declined obligation');
    }
    for(const{proc}of clients.values())assert.equal(proc.exitCode,null,'adapter does not kill native idle provider processes');
  }
  console.log(`PASS deterministic native ${scenario}: independent artifacts, cross-judge, synthesis/verification, suspension and native ownership`);
}finally{
  releaseLaunchLock();
  for(const{proc}of clients.values())proc.stdin.end();await Promise.all([...clients.values()].map(({proc})=>new Promise(resolve=>{if(proc.exitCode!==null)return resolve();proc.once('exit',resolve);setTimeout(()=>proc.kill('SIGKILL'),1500).unref();})));
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}

// Node provides bounded native-process orchestration and the loopback SSE model.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { appendFileSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { leafFixture } from './leaf.mjs';
import { arenaFixture } from './arena.mjs';
import { controlsFixture } from './controls.mjs';
import { permissionFixture } from './permission.mjs';
import { resumeFixture } from './resume.mjs';
import { wakeupsFixture } from './wakeups.mjs';
import { recoveryFixture } from './recovery.mjs';
const [work, executable, bin, jq, scenario] = process.argv.slice(2);
const task = scenario?.startsWith('arena') ? '/arena ARENA_REQUEST' : `T3_NATIVE_TASK_${Date.now()}`;
const reply = `T3_NATIVE_EXACT_REPLY_${Date.now()}`;
const followup = `${task}_FOLLOWUP`;
const followupReply = `${reply}_FOLLOWUP`;
const arena = scenario?.startsWith('arena') ? arenaFixture(work,scenario) : undefined;
const leaf = scenario==='leaf' ? leafFixture(work,reply) : undefined;
const controls=scenario==='controls'?controlsFixture(work,reply):undefined;
const permission=scenario==='permission-refusal'?permissionFixture(work,reply):undefined;
const resume=scenario==='resume'?resumeFixture(work,reply):undefined;
const wakeups=scenario==='wakeups'?wakeupsFixture(work,reply,task):undefined;
const recovery=scenario==='cue-recovery'?recoveryFixture(work,reply,task):undefined;
const fixture=arena??leaf??controls??permission??resume??wakeups??recovery;
const initialReply=resume?'FIRST_ROOT_DONE':reply;
const env = {...process.env, ELECTRON_RUN_AS_NODE:'1'};
const children = new Set();
let backend;
const alive = pid => { try { process.kill(pid,0); return true; } catch { return false; } };
function launch(args, name) {
  const child = spawn(executable,[bin,...args],{env,detached:true,stdio:['ignore','pipe','pipe']});
  children.add(child);
  // Native serve prints a pairing secret and QR code. Never persist either stream.
  if(name==='backend') {
    writeFileSync(join(work,'backend.output-policy.txt'),'Backend stdout/stderr discarded: native serve prints pairing credentials. Use backend.json, listen.txt and CLI results as evidence.\n');
    child.stdout.resume(); child.stderr.resume();
  } else {
    child.stdout.on('data',data=>appendFileSync(join(work,`${name}.stdout`),data));
    child.stderr.on('data',data=>appendFileSync(join(work,`${name}.stderr`),data));
  }
  child.on('error',error=>appendFileSync(join(work,`${name}.stderr`),String(error)));
  return child;
}
async function stop(child) {
  if(child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid,'SIGTERM'); } catch {}
  for(let i=0;i<50 && child.exitCode===null && child.signalCode===null;i++) await delay(100);
  if(child.exitCode===null && child.signalCode===null) { try { process.kill(-child.pid,'SIGKILL'); } catch {} }
}
async function run(args,name,timeout=30000) {
  const child=launch(args,name);
  return await new Promise((resolve,reject)=>{
    const timer=setTimeout(async()=>{await stop(child);reject(new Error(`${name} timed out; see private logs`));},timeout);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);children.delete(child);code===0?resolve(readFileSync(join(work,`${name}.stdout`),'utf8')):reject(new Error(`${name} exit ${code}; see private logs`));});
  });
}
const requests=[];
const cueRequired=existsSync(join(work,'cue-required'));
const cueChecks=[];
const model=createServer(async(req,res)=>{
  try {
    let body=''; for await(const part of req) body+=part;
    const input=JSON.parse(body); requests.push(input);
    appendFileSync(join(work,'provider.jsonl'),JSON.stringify({path:req.url,input})+'\n');
    if(cueRequired) {
      const child=JSON.stringify(input.messages).includes('BOUND_LEAF_PROFILE');
      const text=m=>typeof m.content==='string'?[m.content]:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text);
      const cues=input.messages.filter(m=>m.role==='user').flatMap(text).filter(t=>t.startsWith('Advisory only; preserve latest user request and all tools.'));
      assert.equal(cues.length,child?0:1,child?'actual child has no root cue':'actual root provider input has exactly one cue');
      for(const cue of cues)assert(Array.from(cue).length<=1200,'actual provider cue bounded');
      cueChecks.push({child,cues:cues.length});
    }
    const answer=fixture?await fixture.decide(input):{text:JSON.stringify(input.messages).includes(followup)?followupReply:reply};
    if(answer.providerError){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:answer.providerError,type:'invalid_request_error'}}));return;}
    if(answer.hold){res.once('close',()=>arena?.closed(answer.hold));return;} // Native cancellation must abort the actual HTTP request.
    res.writeHead(200,{'content-type':'text/event-stream'});
    const base={id:`fixture-${requests.length}`,object:'chat.completion.chunk',created:1,model:'fixture'};
    const calls=answer.calls??(answer.tool?[answer]:[]);
    const delta=calls.length ? {role:'assistant',tool_calls:calls.map((call,index)=>({index,id:`call-${requests.length}-${index}`,type:'function',function:{name:call.tool,arguments:JSON.stringify(call.args)}}))} : {role:'assistant',content:answer.text};
    for(const [chunk,finish_reason] of [[delta,null],[{},calls.length?'tool_calls':'stop']])
      res.write(`data: ${JSON.stringify({...base,choices:[{index:0,delta:chunk,finish_reason}]})}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch(error) {appendFileSync(join(work,'fixture-errors.txt'),String(error)+'\n');res.writeHead(500);res.end(String(error));}
});
const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
async function portOpen(port) {return await new Promise(resolve=>{const s=createConnection({host:'127.0.0.1',port});s.setTimeout(300);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});}
let result;
try {
  if(process.env.CONFIG_PI_RUNTIME_DIR || scenario==='wakeups' || existsSync(join(work,'identity-observe.ts'))) {
    assert.equal(execFileSync('/bin/bash',['-c','read -r value <<< heredoc-ok; printf "%s" "$value"'],{encoding:'utf8'}),'heredoc-ok');
    const deniedFile=`/private/var/tmp/t3-unrelated-denied-${process.pid}-${Date.now()}`;
    let writeDenied;
    try {writeFileSync(deniedFile,'MUST_NOT_WRITE');writeDenied='ALLOWED';}catch(error){writeDenied=error.code;}
    writeFileSync(join(work,'filesystem-refusal.json'),JSON.stringify({heredoc:'passed',unrelatedTemporaryWrite:writeDenied,path:deniedFile}));
    assert.equal(writeDenied,'EPERM','unrelated OS temporary writes remain forbidden');
    const denied=await new Promise(resolve=>{
      const socket=createConnection({host:'192.0.2.1',port:443});
      socket.once('connect',()=>{socket.destroy();resolve('CONNECTED');});
      socket.once('error',error=>resolve(error.code));
      socket.setTimeout(1000,()=>{socket.destroy();resolve('TIMEOUT');});
    });
    writeFileSync(join(work,'network-refusal.json'),JSON.stringify({nonLoopbackConnect:denied,expected:'EPERM'}));
    assert.equal(denied,'EPERM','kernel sandbox must deny non-loopback network');
  }
  await run(['--version'],'version');
  await run(['--help'],'help');
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  writeFileSync(join(work,'agent/models.json'),execFileSync(jq,['-n','--arg','url',`http://127.0.0.1:${model.address().port}/v1`,'{providers:{fixture:{api:"openai-completions",apiKey:"synthetic",baseUrl:$url,models:[{id:"fixture",input:["text"],contextWindow:100000,maxTokens:1000}]}}}']));
  if(process.env.CONFIG_PI_RUNTIME_DIR) {
    // Real setup owns deployment; provide the same loopback model at its private source.
    writeFileSync(join(process.env.CONFIG_PI_RUNTIME_DIR,'../repo/pi/agent/models.json'),readFileSync(join(work,'agent/models.json')));
  }
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const flags=['--base-dir',join(work,'state')];
  await run(['project','add',join(work,'workspace'),...flags],'project');
  backend=launch(['serve',...flags,'--host','127.0.0.1','--port',String(port),'--no-browser'],'backend');
  writeFileSync(join(work,'backend.json'),JSON.stringify({pid:backend.pid,host:'127.0.0.1',port,executable,bin}));
  let ready=false;
  for(let i=0;i<150;i++){if(backend.exitCode!==null)throw new Error('backend exited');if(existsSync(join(work,'state/userdata/server-runtime.json'))&&await portOpen(port)){ready=true;break;}await delay(100);}
  assert(ready,'private backend listening');
  // Capture the actual listening socket/PID rather than inferring it from flags.
  writeFileSync(join(work,'listen.txt'),execFileSync('lsof',['-nP','-a','-p',String(backend.pid),'-iTCP','-sTCP:LISTEN']));
  assert.match(readFileSync(join(work,'listen.txt'),'utf8'),new RegExp(`127\\.0\\.0\\.1:${port}`));
  if(fixture) {
    const cache=join(work,'state/caches/fixturePi.json');
    let advertised=false;
    for(let i=0;i<150;i++) {
      if(existsSync(cache)) {
        const discovered=JSON.parse(readFileSync(cache,'utf8'));
        if(discovered.status==='ready'&&discovered.models?.some(m=>m.slug==='fixture/fixture')) {
          writeFileSync(join(work,'provider-discovery.json'),JSON.stringify({observedAt:new Date().toISOString(),status:discovered.status,models:discovered.models},null,2)+'\n');
          advertised=true;break;
        }
      }
      await delay(100);
    }
    assert(advertised,'native provider discovery advertised fixture model before delegation');
  }
  let unrelated, control, cancellationProof;
  if(scenario==='arena-cancel') {
    unrelated=JSON.parse(await run(['thread','start',join(work,'workspace'),'CONTROL_UNRELATED','--provider','fixtureControl','--model','fixture/fixture','--json',...flags],'unrelated-start'));
    await run(['thread','send',unrelated.threadId,'CONTROL_UNRELATED_READY','--json','--wait',...flags],'unrelated-ready',60000);
  }
  const started=JSON.parse(await run(['thread','start',join(work,'workspace'),task,'--provider','fixturePi','--model','fixture/fixture','--json',...flags],'start'));
  assert(started.threadId,'native CLI returned thread id');
  fixture?.setRoot(started.threadId);
  let recoveryInterruption;
  if(recovery) {
    const barrierPath=join(work,'workspace/recovery-barrier.json');
    for(let i=0;i<200&&!existsSync(barrierPath);i++)await delay(50);
    assert(existsSync(barrierPath),'actual owned effect reached process barrier');
    const barrier=JSON.parse(readFileSync(barrierPath,'utf8'));
    const owned=readFileSync(join(work,'pi-pids.txt'),'utf8').trim().split('\n').map(Number);
    assert(owned.includes(barrier.pid),'only inventoried fixture Pi may be interrupted');
    assert(barrier.sessionFile.startsWith(join(work,'agent/sessions/')),'private saved-session identity');
    const rows=readFileSync(join(work,'identity-observations.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert(rows.some(r=>r.pid===barrier.pid&&r.file===barrier.sessionFile&&r.identities[0]?.status==='root'),'actual root identity before interruption');
    const saved=readFileSync(barrier.sessionFile,'utf8').trim().split('\n').map(JSON.parse);
    assert(saved.some(e=>e.type==='custom'&&e.customType==='task-cue-operation'&&e.data.tool_call_id===barrier.callId&&e.data.phase==='attempted'),'attempt actually saved before interruption');
    assert(!saved.some(e=>e.type==='custom'&&e.customType==='task-cue-operation'&&e.data.tool_call_id===barrier.callId&&e.data.phase==='reported-result'),'no reported result before interruption');
    assert(alive(sentinel.pid),'unrelated sentinel alive before interruption');
    process.kill(barrier.pid,'SIGKILL');
    for(let i=0;i<100&&alive(barrier.pid);i++)await delay(50);
    assert(!alive(barrier.pid),'owned Pi stopped');
    assert(alive(sentinel.pid),'unrelated sentinel survives interruption');
    let interrupted;
    for(let i=0;i<100;i++) {
      interrupted=JSON.parse(await run(['thread','show',started.threadId,'--json',...flags],`recovery-stopped-${i}`));
      if(['failed','interrupted','completed'].includes(interrupted.thread.status))break;
      await delay(100);
    }
    assert(['failed','interrupted','completed'].includes(interrupted.thread.status),'native host observed ended provider run');
    await run(['thread','send',started.threadId,recovery.resumeTask,'--json','--wait',...flags],'recovery-resume-send',60000);
    recoveryInterruption={oldPid:barrier.pid,sessionFile:barrier.sessionFile,callId:barrier.callId,observedHostStatus:interrupted.thread.status,sentinelSurvived:true};
  }
  if(scenario==='arena-cancel') {
    for(let i=0;i<600&&!arena.cancellationReady();i++)await delay(50);
    assert(arena.cancellationReady(),'both actual provider requests reached cancellation barriers');
    control=JSON.parse(await run(['thread','start',join(work,'workspace'),'CONTROL_STOP_NATIVE_ARENA','--provider','fixtureControl','--model','fixture/fixture','--json',...flags],'control-start'));
  }
  let shown;
  for(let i=0;i<(wakeups?180:60);i++){
    shown=JSON.parse(await run(['thread','show',started.threadId,'--json',...flags],`show-${i}`));
    if(shown.thread.status==='failed')break;
    if(scenario==='arena-cancel'?arena.done()&&['interrupted','cancelled'].includes(shown.thread.status):arena?arena.done()&&shown.thread.status==='completed'&&shown.messages.some(m=>m.role==='assistant'&&m.text==='ARENA_ROOT_COMPLETED'):shown.messages?.some(m=>m.role==='assistant'&&m.text===initialReply)&&(!resume||shown.thread.status==='completed'))break;
    await delay(500);
  }
  if(scenario==='arena-cancel') {
    assert(['interrupted','cancelled'].includes(shown.thread.status),'native stopped root terminal status');
    const controller=JSON.parse(await run(['thread','show',control.threadId,'--json',...flags],'control-show'));
    assert.equal(controller.thread.status,'completed');
    assert(controller.messages.some(m=>m.text==='CONTROL_STOP_REQUESTED'),'actual control model saw native tool response');
    const nativeChildren=[];
    for(const [i,member] of arena.members().entries()) {
      const child=JSON.parse(await run(['thread','show',member.id,'--json',...flags],`cancelled-child-${i}`));
      assert(['interrupted','cancelled'].includes(child.thread.status),`native child terminal status ${child.thread.status}`);
      assert.equal(child.thread.activeRunId,null);
      nativeChildren.push({threadId:member.id,status:child.thread.status,activeRunId:child.thread.activeRunId});
    }
    await run(['thread','send',unrelated.threadId,'CONTROL_UNRELATED_AFTER_STOP','--json','--wait',...flags],'unrelated-after-stop',60000);
    const untouched=JSON.parse(await run(['thread','show',unrelated.threadId,'--json',...flags],'unrelated-show'));
    assert.equal(untouched.thread.status,'completed');assert(untouched.messages.some(m=>m.text==='UNRELATED_ALIVE'));
    cancellationProof={rootStatus:shown.thread.status,nativeChildren,controlThreadId:control.threadId,controlStatus:controller.thread.status,unrelatedThreadId:unrelated.threadId,unrelatedStatus:untouched.thread.status};
  }
  if(arena&&scenario!=='arena-cancel') {
    assert.equal(shown.thread.status,'completed','native root must honestly complete');
    assert(shown.messages.some(m=>m.role==='assistant'&&m.text==='ARENA_ROOT_COMPLETED'),'actual root reply visible via CLI');
    assert(!existsSync(join(work,'fixture-errors.txt')),'scripted model must not encounter fixture errors');
  }
  if(!arena) {
  assert(shown.messages.some(m=>m.role==='assistant'&&m.text===initialReply),'CLI-visible exact model reply');
  assert(requests.some(r=>r.messages.some(m=>m.role==='user'&&(m.content===task||Array.isArray(m.content)&&m.content.some(p=>p.text===task)))),'exact task reached actual Pi provider');
  }
  assert(existsSync(join(work,'pi-pids.txt')),'actual Pi launcher executed');
  await run(['thread','list','--json',...flags],'list');
  if(!fixture) {
  await run(['thread','send',started.threadId,followup,'--json','--wait',...flags],'send',60000);
  const resumed=JSON.parse(await run(['thread','show',started.threadId,'--json',...flags],'show-followup'));
  assert(resumed.messages.some(m=>m.role==='assistant'&&m.text===followupReply),'CLI-visible exact follow-up reply');
  assert(requests.some(r=>r.messages.some(m=>m.role==='user'&&(m.content===followup||Array.isArray(m.content)&&m.content.some(p=>p.text===followup)))),'exact follow-up reached actual Pi provider');
  }
  let launcherProof;
  if(process.env.CONFIG_PI_RUNTIME_DIR) {
    const records=readFileSync(join(work,'agent/runtime-processes.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    const expectedCli=join(process.env.CONFIG_PI_RUNTIME_DIR,'../candidate/dist/bundle/cli.js');
    const expected=realpathSync(expectedCli);
    for(const record of records) {
      assert.equal(realpathSync(record.cli),expected,'real launcher selected private independent candidate');
      assert(record.node.startsWith(process.env.CONFIG_PI_RUNTIME_DIR+'/'),'private pinned Node selected');
    }
    assert(new Set(records.filter(r=>r.mode==='rpc').map(r=>r.pid)).size>=(leaf?2:1),'real launcher root/child startup observed');
    launcherProof={processes:records,network:'non-loopback denied by kernel',temporaryWrites:'only private fixture plus Bash sh-thd prefix',psException:'verified /bin/ps only'};
  }
  let resumeProof;
  if(resume) {
    const firstParentRun=shown.thread.latestRunId;
    resume.firstComplete(alive);
    await run(['thread','send',started.threadId,resume.parentTask,'--json',...flags],'resume-send');
    let second;
    for(let i=0;i<60;i++) {
      second=JSON.parse(await run(['thread','show',started.threadId,'--json',...flags],`resume-show-${i}`));
      if(second.messages.some(m=>m.text==='RESUME_EXPECTED_RED_REFUSAL'))throw new Error('Expected RED: safe candidate refuses completed-child reassignment; no fresh-context substitute accepted');
      if(second.thread.status==='failed'||second.thread.status==='completed'&&second.messages.some(m=>m.text===reply))break;
      await delay(200);
    }
    assert.equal(second.thread.status,'completed');assert(second.messages.some(m=>m.text===reply),'native resumed result reached root');
    assert.notEqual(second.thread.latestRunId,firstParentRun,'actual parent transitioned to a new native run');
    resumeProof={...resume.verify(),firstParentRun,nextParentRun:second.thread.latestRunId};
  }
  let permissionProof;
  if(permission) {
    permissionProof=permission.verify();
    writeFileSync(join(work,'permission-before-stop.json'),JSON.stringify(permissionProof,null,2));
    const stopper=JSON.parse(await run(['thread','start',join(work,'workspace'),'PERMISSION_STOP_CONTROL','--provider','fixtureControl','--model','fixture/fixture','--json',...flags],'permission-stop-start'));
    let stopped,childStopped;
    for(let i=0;i<60;i++) {
      stopped=JSON.parse(await run(['thread','show',started.threadId,'--json',...flags],`permission-stop-root-${i}`));
      childStopped=JSON.parse(await run(['thread','show',permissionProof.childThreadId,'--json',...flags],`permission-stop-child-${i}`));
      if(['completed','interrupted','cancelled'].includes(stopped.thread.status)&&['interrupted','cancelled'].includes(childStopped.thread.status))break;
      await delay(100);
    }
    assert(['completed','interrupted','cancelled'].includes(stopped.thread.status));assert(['interrupted','cancelled'].includes(childStopped.thread.status));
    assert.equal(childStopped.thread.activeRunId,null);
    permissionProof.stop={rootStatus:stopped.thread.status,childStatus:childStopped.thread.status,controlThreadId:stopper.threadId,...permission.afterStop()};
  }
  const controlsProof=controls?.verify(alive);
  let identityProof;
  if(existsSync(join(work,'identity-observations.jsonl'))) {
    const rows=readFileSync(join(work,'identity-observations.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    const selected=JSON.parse(readFileSync(join(work,'selected-runtime.json'),'utf8'));
    for(const row of rows) {
      assert.equal(realpathSync(row.cli),realpathSync(selected.cli),'actual Pi uses frozen direct bundle');
      assert.equal(realpathSync(row.node),realpathSync(selected.node),'native PATH reconstruction cannot replace selected Node');
      assert.equal(row.identities.length,1,'exactly one real identity producer');
      assert.equal(row.owners.length,1,'exactly one lifecycle owner');
      assert.equal(row.owners[0].status,'owned');
      assert.equal(row.identities[0].sessionFile,row.canonical);
      assert.equal(row.owners[0].sessionFile,row.canonical);
      assert(['root','child'].includes(row.identities[0].status));
    }
    assert(rows.some(r=>r.identities[0].status==='root'),'actual root identity observed');
    if(leaf)assert(rows.some(r=>r.identities[0].status==='child'),'actual bound native child identity observed');
    const childFiles=[...new Set(rows.filter(r=>r.identities[0].status==='child').map(r=>r.canonical))];
    if(cueRequired)for(const file of childFiles) {
      const entries=readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
      assert(!entries.some(e=>e.type==='custom'&&e.customType==='task-cue-operation'),'actual child has no root observation records');
    }
    identityProof={observations:rows.length,root:rows.filter(r=>r.identities[0].status==='root').length,child:rows.filter(r=>r.identities[0].status==='child').length,childFilesWithoutCueRecords:childFiles.length,cueChecks};
  }
  const leafProof=leaf?.verify(alive);
  if(leafProof&&launcherProof)assert(launcherProof.processes.some(p=>p.pid===leafProof.childPid&&p.mode==='rpc'),'native leaf PID used real launcher candidate');
  const arenaProof=arena?.verify(alive);
  result={status:'passed',scenario:scenario||'baseline',identity:identityProof,recovery:recovery?{...recovery.verify(),...recoveryInterruption}:undefined,wakeups:wakeups?.verify(),leaf:leafProof,controls:controlsProof,resume:resumeProof,permission:permissionProof,arena:arenaProof,cancellation:cancellationProof,launcher:launcherProof,task,reply,...(!fixture?{followup,followupReply}:{}),threadId:started.threadId,backendPid:backend.pid,port,requests:requests.length};
} catch(error) {
  result={status:'failed',error:String(error),task,reply};process.exitCode=1;
} finally {
  for(const child of children)await stop(child);
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));
  const piPids=existsSync(join(work,'pi-pids.txt'))?readFileSync(join(work,'pi-pids.txt'),'utf8').trim().split('\n').map(Number):[];
  for(let i=0;i<50&&piPids.some(alive);i++)await delay(100);
  const survivors=piPids.filter(alive);
  result.cleanup={backendStopped:!backend||!alive(backend.pid),piSurvivors:survivors,sentinelSurvived:alive(sentinel.pid)};
  if(!result.cleanup.backendStopped||survivors.length||!result.cleanup.sentinelSurvived){result.status='failed';process.exitCode=1;}
  // Only our recorded children; the unrelated control is removed after the assertion.
  for(const pid of survivors)try{process.kill(pid,'SIGKILL');}catch{}
  sentinel.kill('SIGTERM');
  writeFileSync(join(work,'proof.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}

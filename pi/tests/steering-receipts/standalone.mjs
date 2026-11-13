// Actual RPC parent + tmux-launched child CLIs, supported completion-fixture mechanism.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdirSync,writeFileSync,readFileSync,appendFileSync,existsSync,realpathSync,cpSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const [sourceArg,cliArg,outArg,socketRoot,selected='throw,positive,drop,stale,fast']=process.argv.slice(2);
const source=realpathSync(sourceArg),out=resolve(outArg);mkdirSync(out,{mode:0o700});
const cli=realpathSync(cliArg);assert(cli.endsWith('/dist/bundle/cli.js'));
const tmuxBin=execFileSync('/bin/sh',['-c','command -v tmux'],{encoding:'utf8'}).trim();assert(tmuxBin);
const jqBin=execFileSync('/bin/sh',['-c','command -v jq'],{encoding:'utf8'}).trim();assert(jqBin);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(join(out,'identity.json'),JSON.stringify({cli,node:process.execPath,source,fixtureHash:hash(fileURLToPath(import.meta.url)),sourceHashes:Object.fromEntries(['index.ts','team.ts','team-extension.ts'].map(f=>[f,hash(join(source,'pi-extension/subagents',f))]))},null,2));
const text=m=>typeof m.content==='string'?m.content:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
const results=[];
async function run(mode){
 const dir=join(out,mode);mkdirSync(dir);for(const d of ['home','agent','cwd','tmp','config','npm','bin'])mkdirSync(join(dir,d));
 const socket=join(socketRoot,mode+'.sock'),fixtureLog=join(dir,'fixture-events.jsonl'),rows=[];
 // Keep Unix socket paths short even when the evidence directory is deeply nested.
 assert(Buffer.byteLength(socket)<100,'private tmux socket path is too long');
 let modeSource=source;
 if(mode==='fast'){
  modeSource=join(dir,'exit-only-source');cpSync(source,modeSource,{recursive:true});
  const index=join(modeSource,'pi-extension/subagents/index.ts');
  assert.equal(realpathSync(index),index,'do not mutate through a symlink');
  const code=readFileSync(index,'utf8'),tick='deliverPendingQuestion(running);\n        deliverInputReceipts(running);';
  assert.equal(code.split(tick).length,2,'known tick call for post-exit-only control');
  writeFileSync(index,code.replace(tick,'deliverPendingQuestion(running); // fixture: tick scan disabled'));
 }
 const log=(type,data={})=>{rows.push({type,...data});appendFileSync(join(dir,'driver-events.jsonl'),JSON.stringify({type,...data})+'\n');};
 const fixture=()=>existsSync(fixtureLog)?readFileSync(fixtureLog,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const statePath=()=>{const rootEvent=fixture().find(e=>e.type==='start'&&e.actor==='root');return rootEvent?join(dir,'home/.pi/teams',rootEvent.sessionId,'state.json'):undefined;};
 const state=()=>{const p=statePath();return p&&existsSync(p)?JSON.parse(readFileSync(p)):undefined;};
 // File barriers mirror existing CLI fixtures. A bounded fixture-only check observes durable artifacts.
 const until=async(fn,label,ms=12000)=>{const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error('Timeout: '+label);await new Promise(r=>setTimeout(r,20));}};
 writeFileSync(join(dir,'bin/tmux'),`#!/bin/bash\n${mode==='drop'?`if [[ "$1" == send-keys && "$4" == -l && "$5" == SUBAGENT_MESSAGE_V1:* ]]; then\n printf '%s' "$3" > ${JSON.stringify(join(dir,'dropped-surface'))}\n printf '%s\\n' "$5" > ${JSON.stringify(join(dir,'dropped-wire.txt'))}\n exit 0\nfi\nif [[ "$1" == send-keys && "$4" == Enter && -f ${JSON.stringify(join(dir,'dropped-surface'))} ]]; then exit 0; fi\n`:mode==='stale'?`if [[ "$1" == send-keys && "$4" == -l && "$5" == SUBAGENT_MESSAGE_V1:* ]]; then\n body=$(printf '%s' "\${5#SUBAGENT_MESSAGE_V1:}" | ${JSON.stringify(jqBin)} -c '.assignmentId="old-launch"') || exit 1\n exec ${JSON.stringify(tmuxBin)} -S ${JSON.stringify(socket)} send-keys -t "$3" -l "SUBAGENT_MESSAGE_V1:$body"\nfi\n`:''}if [[ "$1" == send-keys && "$4" == -l && "$5" == SUBAGENT_MESSAGE_V1:* ]]; then printf '%s' "$5" > ${JSON.stringify(join(dir,'wire.txt'))}; fi\nexec ${JSON.stringify(tmuxBin)} -S ${JSON.stringify(socket)} "$@"\n`,{mode:0o755});
 const env={PATH:join(dir,'bin')+':'+dirname(process.execPath)+':'+dirname(tmuxBin)+':/usr/bin:/bin',HOME:join(dir,'home'),PI_CODING_AGENT_DIR:join(dir,'agent'),CONFIG_PI_HOME:join(dir,'config'),NPM_CONFIG_PREFIX:join(dir,'npm'),TMPDIR:join(dir,'tmp'),PI_OFFLINE:'1',LANG:'en_US.UTF-8',TERM:'xterm-256color'};
 const tmux=(...args)=>execFileSync(tmuxBin,['-S',socket,...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const ROOT_TASK='ROOT_ORIGINAL_TASK_PRESERVE_WORK',CHILD_TASK='CHILD_ORIGINAL_TASK_PRESERVE_TWO_TOOLS',message='EXACT_STEERING_BODY_5af19a\nKeep the original work and both tool results.';
 const requests={parent:[],child:[]};let providerFailure;
 const reply=(res,calls=[],content='COMPLETE')=>{
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const delta=calls.length?{role:'assistant',tool_calls:calls.map(([id,name,args],index)=>({index,id,type:'function',function:{name,arguments:JSON.stringify(args)}}))}:{role:'assistant',content};
  for(const [d,finish_reason]of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:d,finish_reason}]})}\n\n`);
  res.end('data: [DONE]\n\n');
 };
 const server=createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  const actor=body.messages.some(m=>m.role==='user'&&text(m)===ROOT_TASK)?'parent':'child';
  const number=requests[actor].push({body,res});writeFileSync(join(dir,`${actor}-provider-${number}.json`),JSON.stringify(body,null,2));log('provider',{actor,number});
  if(actor==='parent'&&number===1)reply(res,[['launch','subagent',{agent:'fixture',name:'tester',task:CHILD_TASK,cwd:join(dir,'cwd')}]]);
  else if(actor==='parent'&&number===2){/* held until child is inside its real tool batch */}
  else if(actor==='parent'&&number===3)reply(res,[['parent-first','held_first',{}],['parent-second','held_second',{}]]);
  else if(actor==='child'&&number===1)reply(res,[['child-first','held_first',{}],['child-second','held_second',{}]]);
  else if(actor==='child'&&number===2){/* keep recipient HTTP open until sender receipt is enqueued */}
  else reply(res,[],'ORIGINAL_WORK_COMPLETE');
 }catch(e){providerFailure=e;res.destroy();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 for(const [name,value]of Object.entries({auth:{},settings:{defaultProvider:'fixture',defaultModel:'fixture',enableAnalytics:false,enableInstallTelemetry:false,retry:{enabled:false},compaction:{enabled:false},cacheWarming:'off',steeringMode:'all',packages:[],defaultProjectTrust:'always'},models:{providers:{fixture:{api:'openai-completions',apiKey:'synthetic-only',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'fixture',input:['text'],contextWindow:64000,maxTokens:1000}]}}}}))writeFileSync(join(dir,'agent',name+'.json'),JSON.stringify(value));
 mkdirSync(join(dir,'agent/agents'));writeFileSync(join(dir,'agent/agents/fixture.md'),'---\nname: fixture\ndescription: Private deterministic child\ntools: held_first, held_second\nthinking: off\nsession-mode: standalone\nauto-exit: true\n---\nExecute only the scripted task.\n');
 const indexPath=join(modeSource,'pi-extension/subagents/index.ts'),wrapperPath=join(dir,'receipt-error-wrapper.ts');
 if(mode==='throw')writeFileSync(wrapperPath,`import install,{__test__} from ${JSON.stringify(indexPath)};import {writeFileSync,appendFileSync} from 'node:fs';
export default function(pi){let failed=false;install({...pi,sendMessage(message,options){if(message.customType==='subagent-message-received'){appendFileSync(${JSON.stringify(join(dir,'notice-attempts.jsonl'))},JSON.stringify({failed:!failed,message})+'\\n');if(!failed){failed=true;setTimeout(()=>writeFileSync(${JSON.stringify(join(dir,'tracking-after-error.json'))},JSON.stringify({tracked:[...__test__.runningSubagents.values()].some(r=>r.name==='tester')})),100);throw Error('INJECTED_RECEIPT_NOTIFICATION_FAILURE');}}return pi.sendMessage(message,options);}});}`);
 const fixturePath=join(dir,'fixture.ts');
 writeFileSync(fixturePath,`import {appendFileSync,existsSync,watch} from 'node:fs';
export default function(pi){
 const actor=process.env.PI_SUBAGENT_NAME?'child':'root';
 const log=(type,data={})=>appendFileSync(${JSON.stringify(fixtureLog)},JSON.stringify({type,actor,...data})+'\\n');
 globalThis.__pi_interactive_subagents?.registerToolExtension('held_first',${JSON.stringify(fixturePath)});
 globalThis.__pi_interactive_subagents?.registerToolExtension('held_second',${JSON.stringify(fixturePath)});
 pi.on('session_start',(_event,ctx)=>log('start',{pid:process.pid,sessionId:ctx.sessionManager.getSessionId(),surface:process.env.PI_SUBAGENT_SURFACE,sessionFile:ctx.sessionManager.getSessionFile()}));
 for(const name of ['held_first','held_second'])pi.registerTool({name,label:name,description:'Private harmless held tool',executionMode:'parallel',parameters:{type:'object',properties:{}},async execute(id,args,signal){
  log('tool_enter',{name});
  await new Promise((resolve,reject)=>{const path=${JSON.stringify(dir)}+'/'+actor+'-release';
   const cleanup=()=>{clearTimeout(timeout);watcher.close();signal?.removeEventListener('abort',abort);};
   const check=()=>{if(existsSync(path)){cleanup();resolve();}};
   const abort=()=>{cleanup();log('tool_aborted',{name});reject(Error('fixture tool aborted'));};
   const watcher=watch(${JSON.stringify(dir)},check);const timeout=setTimeout(()=>{cleanup();reject(Error('tool barrier timeout'));},25000);signal?.addEventListener('abort',abort,{once:true});check();
  });
  log('tool_exit',{name,aborted:signal?.aborted});return {content:[{type:'text',text:name+'_RESULT'}],details:{}};
 }});
 pi.on('input',event=>log('input',{text:event.text}));
}`);
 let child,parentPane,exited,error;
 try{
  parentPane=tmux('-f','/dev/null','new-session','-d','-x','180','-y','50','-P','-F','#{pane_id}','-s','receipt','exec cat');
  tmux('set-option','-g','default-shell','/bin/bash');tmux('set-option','-g','default-command','exec bash --noprofile --norc');
  const args=[cli,'--mode','rpc','--offline','--no-extensions','--no-skills','--no-prompt-templates','--no-builtin-tools','--tools','subagent,subagent_message,held_first,held_second','-e',mode==='throw'?wrapperPath:indexPath,'-e',fixturePath,'--session',join(dir,'parent.jsonl'),'--thinking','off','--no-approve'];
  const childEnv={...env,TMUX:socket+',0,0',TMUX_PANE:parentPane};writeFileSync(join(dir,'launch.json'),JSON.stringify({executable:process.execPath,args,env:childEnv,cwd:join(dir,'cwd')},null,2));
  child=spawn(process.execPath,args,{env:childEnv,cwd:join(dir,'cwd'),stdio:['pipe','pipe','pipe']});exited=once(child,'exit');let buffer='';
  child.stderr.on('data',b=>appendFileSync(join(dir,'stderr.txt'),b));child.stdout.on('data',b=>{appendFileSync(join(dir,'stdout.jsonl'),b);buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{log('rpc',{event:JSON.parse(line)});}catch{}}});
  const command=async value=>{child.stdin.write(JSON.stringify(value)+'\n');await until(()=>rows.some(e=>e.type==='rpc'&&e.event.type==='response'&&e.event.id===value.id),'RPC '+value.id);const r=rows.find(e=>e.type==='rpc'&&e.event.type==='response'&&e.event.id===value.id).event;assert(r.success,JSON.stringify(r));return r;};
  await command({id:'root',type:'prompt',message:ROOT_TASK});
  await until(()=>requests.parent.length>=2&&fixture().filter(e=>e.actor==='child'&&e.type==='tool_enter').length===2,'actual launched child held in two tools');
  assert.equal(state().desired,false,'team OFF');
  reply(requests.parent[1].res,[['steering','subagent_message',{name:'tester',message}]]);
  await until(()=>requests.parent.length>=3&&fixture().filter(e=>e.actor==='root'&&e.type==='tool_enter').length===2,'sender Sent result and original tools held');
  const sent=requests.parent[2].body.messages.filter(m=>m.role==='tool'&&m.tool_call_id==='steering').map(text).join('');
  const match=sent.match(/^Sent message ([a-f0-9]{12}) to tester\.$/),id=match?.[1],notice=id?'tester received message '+id+'.':undefined;
  const target=fixture().find(e=>e.actor==='child'&&e.type==='start');
  const childEntries=()=>readFileSync(target.sessionFile,'utf8').trim().split('\n').map(JSON.parse);
  const receipts=()=>childEntries().filter(e=>e.type==='custom'&&e.customType==='subagent-message-received'&&e.data.messageId===id);
  const positive=mode==='positive'||mode==='fast'||mode==='throw';
  if(id&&positive&&mode!=='fast'){
   await until(()=>receipts().length===1,'saved recipient input receipt while tools still held');
   if(mode==='throw'){
    await until(()=>existsSync(join(dir,'tracking-after-error.json')),'injected notice error observed independently');
    assert.equal(JSON.parse(readFileSync(join(dir,'tracking-after-error.json'))).tracked,true,'receipt failure must not delete healthy child tracking');
    assert(alive(target.pid),'receipt failure must not terminate healthy child');
    assert(tmux('list-panes','-a','-F','#{pane_id}').split('\n').includes(target.surface),'receipt failure must not close healthy child surface');
   }
   writeFileSync(join(dir,'root-release'),'release');
   await until(()=>requests.parent.some(r=>r.body.messages.some(m=>m.role==='user'&&text(m)===notice)),'automatic parent receipt at actual provider input');
   assert.equal(requests.child.length,1,'receipt does not wait for next child model input');
   assert.equal(fixture().filter(e=>e.actor==='child'&&e.type==='tool_exit').length,0,'child tools remain held when sender receives receipt');
   writeFileSync(join(dir,'held-receipt-proof.json'),JSON.stringify({childProviderRequests:requests.child.length,childToolExits:0,notice,assignmentId:receipts()[0].data.assignmentId},null,2));
   const wire=readFileSync(join(dir,'wire.txt'),'utf8');
   tmux('send-keys','-t',target.surface,'-l',wire);tmux('send-keys','-t',target.surface,'Enter');
   await until(()=>fixture().filter(e=>e.actor==='child'&&e.type==='input'&&e.text===wire).length===2,'same-assignment duplicate reaches actual input hook');
  }
  writeFileSync(join(dir,'child-release'),'release');
  await until(()=>requests.child.length>=2,'original child continuation');
  reply(requests.child[1].res,[],'CHILD_ORIGINAL_WORK_COMPLETE');
  await until(()=>!alive(target.pid),'actual child exits normally');
  writeFileSync(join(dir,'root-release'),'release');
  await until(()=>requests.parent.length>=4,'original parent continuation');
  await until(()=>rows.some(e=>e.type==='rpc'&&e.event.type==='agent_settled'),'parent settles');
  if(id&&mode==='fast')await until(()=>requests.parent.some(r=>r.body.messages.some(m=>m.role==='user'&&text(m)===notice)),'post-exit scan delivers receipt with tick scanning disabled');
  if(providerFailure)throw providerFailure;
  assert(match,'immediate concise Sent-with-ID result');
  const entries=readFileSync(join(dir,'parent.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const received=entries.filter(e=>e.type==='custom_message'&&e.customType==='subagent-message-received'&&e.content===notice);
  assert.equal(received.length,positive?1:0,'automatic inbox receipt is separate from completion');
  assert.equal(receipts().length,positive?1:0,'same assignment duplicates append at most one receipt; old assignment does not acknowledge');
  if(mode==='drop')assert(existsSync(join(dir,'dropped-wire.txt')),'drop actually intercepted forwarding');
  if(mode!=='drop')assert(requests.child[1].body.messages.some(m=>m.role==='user'&&text(m)===message),'exact multiline original text reaches child later');
  assert.equal(requests.child.length,2,'no extra recipient tool call or provider turn');
  for(const name of ['held_first','held_second']){
   assert(requests.child[1].body.messages.some(m=>m.role==='tool'&&text(m)===name+'_RESULT'),'child result preserved');
   assert(requests.parent.slice(3).some(r=>r.body.messages.some(m=>m.role==='tool'&&text(m)===name+'_RESULT')),'parent result preserved');
  }
  if(mode==='throw'){
   const attempts=readFileSync(join(dir,'notice-attempts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
   assert.equal(attempts.length,2,'failed notice retried once, then deduplicated');
   assert(readFileSync(join(dir,'stderr.txt'),'utf8').includes('INJECTED_RECEIPT_NOTIFICATION_FAILURE'),'ordinary notice error is reported');
  }
  if(positive){
   const atSent=entries.findIndex(e=>e.type==='message'&&e.message.toolName==='subagent_message'&&e.message.details?.messageId===id);
   assert(atSent>=0&&atSent<entries.indexOf(received[0]),'saved Sent precedes received');
  }

 }catch(e){error=e;writeFileSync(join(dir,'failure.txt'),e.stack+'\n');}
 finally{
  try{for(const pane of tmux('list-panes','-a','-F','#{pane_id}').split('\n'))writeFileSync(join(dir,'screen-before-'+pane.slice(1)+'.txt'),tmux('capture-pane','-p','-t',pane,'-S','-100'));}catch{}
  if(child){child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await exited;clearTimeout(timer);}
  try{for(const pane of tmux('list-panes','-a','-F','#{pane_id}').split('\n'))writeFileSync(join(dir,'screen-'+pane.slice(1)+'.txt'),tmux('capture-pane','-p','-t',pane,'-S','-100'));}catch{}
  try{tmux('kill-server');}catch{}
  server.closeAllConnections();await new Promise(r=>server.close(r));
  const pids=fixture().filter(e=>e.type==='start').map(e=>e.pid);if(child?.pid)pids.push(child.pid);
  await until(()=>pids.every(p=>!alive(p)),'owned processes cleaned up');
  let serverGone=false;try{tmux('list-sessions');}catch{serverGone=true;}
  writeFileSync(join(dir,'cleanup.json'),JSON.stringify({pids:pids.map(pid=>({pid,alive:alive(pid)})),tmuxServerGone:serverGone,httpClosed:!server.listening,parentExitCode:child?.exitCode,parentExitSignal:child?.signalCode},null,2));
  assert(serverGone&&!server.listening);
 }
 const result={mode,status:error?'FAIL':'PASS',error:error?.message,parentRequests:requests.parent.length,childRequests:requests.child.length};writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));return result;
}
for(const mode of selected.split(','))results.push(await run(mode));
writeFileSync(join(out,'summary.json'),JSON.stringify({results},null,2));console.log(JSON.stringify(results,null,2));
assert(results.every(r=>r.status==='PASS'),'all standalone receipt cases pass');

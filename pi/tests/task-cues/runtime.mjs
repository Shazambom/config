// Actual bundled CLI and loopback wire capture. Node handles concurrent RPC and SSE.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdirSync,writeFileSync,appendFileSync,readFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const candidate=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const [cliArg,evidenceArg,mode='root']=process.argv.slice(2);
const cli=resolve(cliArg), evidence=resolve(evidenceArg);
mkdirSync(evidence,{recursive:true,mode:0o700});
for(const d of ['home','agent','cwd'])mkdirSync(join(evidence,d));
const session=join(evidence,'session.jsonl'), events=join(evidence,'events.jsonl');
const text=m=>typeof m.content==='string'?m.content:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
let number=0;
const requests=[];
const recovery=mode==='recovery';
const server=createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;
 const body=JSON.parse(raw);requests.push(body);appendFileSync(events,JSON.stringify({type:'provider',number:++number,body})+'\n');
 const calls=number===1?[{index:0,id:'write-one',type:'function',function:{name:'write',arguments:JSON.stringify({path:'artifact.txt',content:'EXACT_ARTIFACT'})}}]:[];
 if(recovery && number===1)calls.push({index:1,id:'held-two',type:'function',function:{name:'held_effect',arguments:'{}'}});
 const delta=calls.length?{role:'assistant',tool_calls:calls}:{role:'assistant',content:'FINISHED'};
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 for(const [d,finish_reason] of [[delta,null],[{},calls.length?'tool_calls':'stop']])res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:d,finish_reason}]})}\n\n`);
 res.end('data: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
writeFileSync(join(evidence,'agent/auth.json'),'{}');
writeFileSync(join(evidence,'agent/models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',apiKey:'synthetic',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'fixture',input:['text','image'],contextWindow:32000,maxTokens:1000}]}}}));
writeFileSync(join(evidence,'agent/settings.json'),JSON.stringify({defaultProvider:'fixture',defaultModel:'fixture',enableAnalytics:false,enableInstallTelemetry:false,retry:{enabled:false},compaction:{enabled:false},packages:[]}));
const fixture=join(evidence,'fixture.ts');
writeFileSync(fixture,`import install from ${JSON.stringify(join(candidate,'pi/agent/task-cues/index.ts'))};
import {appendFileSync} from 'node:fs';
export default function(pi){
 let file;
 pi.on('session_start',(_,ctx)=>{file=ctx.sessionManager.getSessionFile()});
 pi.events.on('subagents:identity',({respond})=>{respond({status:${JSON.stringify(mode==='child'?'child':mode==='unknown'?'unknown':'root')},sessionFile:${mode==='stale'?JSON.stringify(session+'.stale'):'file'}});${mode==='multiple'?'respond({status:"root",sessionFile:file});':''}});
 pi.events.on('session-lifecycle:admission',({respond})=>respond({managed:true,status:'owned',sessionFile:file,generation:'private-component-owner'}));
 install(pi);
 ${recovery?`pi.registerTool({name:'held_effect',label:'held_effect',description:'Private owned barrier',executionMode:'sequential',parameters:{type:'object',properties:{}},async execute(id,args,signal,onUpdate){appendFileSync('counter.txt','1\\n');onUpdate({content:[{type:'text',text:'OWNED_EFFECT_BARRIER'}],details:{}});await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));return {content:[],details:{}};}});`:''}
 ${mode==='drop'?"pi.on('context',(event)=>({messages:event.messages.filter(m=>m.customType!=='task-cue')}));":''}
 pi.on('context',(event)=>appendFileSync(${JSON.stringify(events)},JSON.stringify({type:'context',messages:event.messages})+'\\n'));
}`);
const launch=()=>spawn(process.execPath,[cli,'--mode','rpc','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-mcp','--tools',recovery?'write,held_effect':'write','-e',fixture,'--session',session],{cwd:join(evidence,'cwd'),env:{PATH:process.env.PATH,HOME:join(evidence,'home'),PI_CODING_AGENT_DIR:join(evidence,'agent'),TMPDIR:evidence,LANG:'en_US.UTF-8'},stdio:['pipe','pipe','pipe']});
let child=launch();
const sentinel=recovery?spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}):null;
async function drive(message,interrupt=false){
 await new Promise((done,fail)=>{
 const timer=setTimeout(()=>fail(Error('CLI deadline')),20000);let pending='';
 child.once('exit',code=>{clearTimeout(timer);fail(Error('early CLI exit '+code));});
 child.stdout.on('data',chunk=>{appendFileSync(join(evidence,'stdout.jsonl'),chunk);pending+=chunk;let n;while((n=pending.indexOf('\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+1);try{const row=JSON.parse(line);if(interrupt && row.type==='tool_execution_update' && JSON.stringify(row).includes('OWNED_EFFECT_BARRIER')){clearTimeout(timer);done();}else if(!interrupt && row.type==='agent_end'){clearTimeout(timer);done();}}catch{}}});
 child.stderr.on('data',chunk=>appendFileSync(join(evidence,'stderr.txt'),chunk));
 child.stdin.write(JSON.stringify({id:'task',type:'prompt',message})+'\n');
 });
}
try{
 await drive('ORIGINAL_TASK_UNCHANGED',recovery);
 if(recovery){
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  process.kill(sentinel.pid,0);
  const saved=readFileSync(session,'utf8').trim().split('\n').map(JSON.parse);
  assert(saved.some(e=>e.type==='custom'&&e.data?.tool_call_id==='held-two'&&e.data.phase==='attempted'));
  assert(!saved.some(e=>e.type==='custom'&&e.data?.tool_call_id==='held-two'&&e.data.phase==='reported-result'));
  child=launch();await drive('NEW_TASK_INVESTIGATE_DO_NOT_REPLAY');
 }
}finally{
 if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.stdin.end();const timer=setTimeout(()=>child.kill('SIGTERM'),2000);await exited;clearTimeout(timer);}
 if(sentinel){process.kill(sentinel.pid,0);const exited=once(sentinel,'exit');sentinel.kill('SIGTERM');await exited;}
 server.closeAllConnections();await new Promise(r=>server.close(r));
}
assert.equal(requests.length,2,'no additional model requests');
assert.equal(readFileSync(join(evidence,'cwd/artifact.txt'),'utf8'),'EXACT_ARTIFACT','fresh artifact inspection');
const second=requests[1];
assert(second.messages.some(m=>m.role==='user'&&text(m).includes('ORIGINAL_TASK_UNCHANGED')),'original task retained');
assert(second.messages.some(m=>m.role==='assistant'&&m.tool_calls?.some(c=>c.id==='write-one')),'original call retained');
assert(second.messages.some(m=>m.role==='tool'&&m.tool_call_id==='write-one'),'original result retained');
if(recovery){
 assert.equal(readFileSync(join(evidence,'cwd/counter.txt'),'utf8'),'1\n','effect not replayed');
 assert(second.messages.some(m=>m.role==='user'&&text(m).includes('NEW_TASK_INVESTIGATE_DO_NOT_REPLAY')),'new resume task delivered');
}
const cues=second.messages.filter(m=>m.role==='user'&&text(m).includes('Advisory only;'));
if(['child','unknown','stale','multiple'].includes(mode))assert.equal(cues.length,0,'nonroot/uncertain identity suppresses only cue');
else{
 assert.equal(cues.length,1,'root advisory reaches actual provider');
 assert(text(cues[0]).includes('reported success'),'actual result fact reaches provider');
 if(recovery){assert(text(cues[0]).includes('unknown'));assert(text(cues[0]).includes('explicit unresolved observation identities=1'));}
 assert(text(cues[0]).includes('saved'),'canonical saved provenance reaches provider');
 assert(Array.from(text(cues[0])).length<=1200,'bounded cue');
}
writeFileSync(join(evidence,'receipt.json'),JSON.stringify({cli,version:execFileSync(process.execPath,[cli,'--version'],{encoding:'utf8'}).trim(),mode,requests:number,identity:'stub-only component proof',passed:true},null,2));
console.log(mode+': PASS (stub identity only)');

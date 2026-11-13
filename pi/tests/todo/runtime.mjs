// Real CLI/RPC and loopback SSE need concurrent JavaScript orchestration.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdirSync,writeFileSync,appendFileSync,readFileSync,copyFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [cli, pkg, rawEvidence, todoArg, sandboxCommand] = process.argv.slice(2);
const evidence=resolve(rawEvidence);
for(const dir of ['home','agent','cwd','tmp']) mkdirSync(join(evidence,dir),{recursive:true});
const todo=resolve(todoArg);
const autoloadedTodo=join(evidence,'agent/extensions/todo.ts');
mkdirSync(join(evidence,'agent/extensions'),{recursive:true});
// A missing source deliberately reaches the real CLI declaration assertion.
if(existsSync(todo))copyFileSync(todo,autoloadedTodo);
const session=join(evidence,'session.jsonl');
const snapshotFile=join(evidence,'live-snapshots.jsonl');
let scheduled=null, providerCalls=0, child, processTimer, errors=[], firstTools, lastTools;
const server=createServer(async(req,res)=>{
 try {
  let raw='';for await(const part of req)raw+=part;
  const body=JSON.parse(raw);providerCalls++;
  lastTools=body.tools?.map(t=>t.function?.name) ?? [];
  firstTools ??= lastTools;
  appendFileSync(join(evidence,'provider.jsonl'),JSON.stringify({request:providerCalls,body})+'\n');
  const params=scheduled;scheduled=null;
  const delta=params?{role:'assistant',tool_calls:[{index:0,id:`call-${providerCalls}`,type:'function',function:{name:'todo',arguments:JSON.stringify(params)}}]}:{role:'assistant',content:'FIXTURE_DONE'};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const [d,finish] of [[delta,null],[{},params?'tool_calls':'stop']])res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:d,finish_reason:finish}]})}\n\n`);
  res.end('data: [DONE]\n\n');
 } catch(e){errors.push(String(e));res.destroy();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
writeFileSync(join(evidence,'agent/auth.json'),'{}');
writeFileSync(join(evidence,'agent/models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',apiKey:'synthetic',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'fixture',input:['text'],contextWindow:32000,maxTokens:1000}]}}}));
writeFileSync(join(evidence,'agent/settings.json'),JSON.stringify({defaultProvider:'fixture',defaultModel:'fixture',defaultThinkingLevel:'off',defaultTools:['bash','codemode'],codemode:{mode:'on'},retry:{enabled:false},compaction:{enabled:false},packages:[],enableAnalytics:false,enableInstallTelemetry:false}));
const observer=join(evidence,'observer.ts');
writeFileSync(observer,`import {appendFileSync} from 'node:fs'; export default function(pi){pi.on('agent_end',(_event,ctx)=>appendFileSync(${JSON.stringify(snapshotFile)},JSON.stringify(ctx.sessionManager.getBranch())+'\\n'));}`);
const sandbox=join(evidence,'sandbox.sb');
writeFileSync(sandbox,`(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath ${JSON.stringify(evidence)}))\n(deny network*)\n(allow network-outbound (remote ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n`);
let waiters=[], rows=[], buffered='';
function launch(){
 buffered='';rows=[];
 const args=[cli,'--mode','rpc','--no-skills','--no-prompt-templates','--no-context-files','--no-mcp','-e',observer,'--session',session];
 // Only the fresh agent directory supplies extensions; TODO must autoload.
 child=spawn(sandboxCommand||process.execPath,sandboxCommand?['-f',sandbox,process.execPath,...args]:args,{cwd:join(evidence,'cwd'),env:{PATH:process.env.PATH,HOME:join(evidence,'home'),TMPDIR:join(evidence,'tmp'),PI_CODING_AGENT_DIR:join(evidence,'agent'),LANG:'en_US.UTF-8'},stdio:['pipe','pipe','pipe']});
 processTimer=setTimeout(()=>{errors.push('process exceeded60seconds');child.kill('SIGKILL');},60000);
 child.stderr.on('data',c=>appendFileSync(join(evidence,'stderr.txt'),c));
 child.stdout.on('data',c=>{appendFileSync(join(evidence,'stdout.jsonl'),c);buffered+=c;let n;while((n=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,n);buffered=buffered.slice(n+1);try{const row=JSON.parse(line);rows.push(row);if(row.type==='agent_end')for(const r of waiters.splice(0))r();}catch{}}});
 child.once('exit',()=>{clearTimeout(processTimer);for(const r of waiters.splice(0))r(new Error('unexpected CLI exit'));});
}
async function drive(params){scheduled=params;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('turn deadline30s')),30000);waiters.push(e=>{clearTimeout(timer);e?reject(e):resolve();});child.stdin.write(JSON.stringify({id:`turn-${providerCalls}`,type:'prompt',message:'Execute the scripted TODO fixture operation.'})+'\n');});}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.stdin.end();const t=setTimeout(()=>child.kill('SIGTERM'),1000);const k=setTimeout(()=>child.kill('SIGKILL'),3000);await exited;clearTimeout(t);clearTimeout(k);}clearTimeout(processTimer);}
let receipt;
try {
 launch();
 await drive({action:'add',text:'Complete requested artifact'});
 assert(firstTools.includes('todo'),'production TODO must autoload and be declared without explicit -e or --tools activation');
 assert(firstTools.includes('bash')&&firstTools.includes('codemode'),'production Bash/codemode defaults stay active');
 await drive({action:'list'});
 await drive({action:'toggle',id:1});
 await drive({action:'list'});
 await drive({action:'toggle',id:999});
 await drive({action:'list'});
 await stop();
 const readRows=()=>readFileSync(session,'utf8').trim().split('\n').map(JSON.parse);
 const results=readRows().filter(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.toolName==='todo');
 assert.equal(results.length,6,'six real tool results');
 assert.equal(results[0].message.details.todos[0].done,false,'durable add snapshot unchanged');
 assert.equal(results[3].message.details.todos[0].done,true,'toggle then list');
 assert.equal(results[4].message.details.error,'#999 not found');
 assert.deepEqual(results[3].message.details.todos,results[5].message.details.todos,'missing id does not mutate');
 const live=readFileSync(snapshotFile,'utf8').trim().split('\n').map(JSON.parse);
 const liveAdd=live.at(-1).find(e=>e.id===results[0].id);
 const liveHistoricalMutation=liveAdd.message.details.todos[0].done!==results[0].message.details.todos[0].done;
 launch();await drive({action:'list'});await stop();
 let latest=readRows().filter(e=>e.message?.role==='toolResult'&&e.message.toolName==='todo').at(-1);
 assert.equal(latest.message.details.todos[0].done,true,'real restart retains completed state');
 launch();await drive({action:'toggle',id:1});await drive({action:'list'});await stop();
 latest=readRows().filter(e=>e.message?.role==='toolResult'&&e.message.toolName==='todo').at(-1);
 assert.equal(latest.message.details.todos[0].done,false,'second toggle intentionally reopens');
 const copied=join(evidence,'rewind.jsonl');copyFileSync(session,copied);
 const {SessionManager}=await import(pathToFileURL(join(pkg,'dist/core/session-manager.js')));
 const {loadExtensions}=await import(pathToFileURL(join(pkg,'dist/core/extensions/loader.js')));
 const manager=SessionManager.open(copied);manager.branch(results[0].id);
 const loaded=await loadExtensions([autoloadedTodo],join(evidence,'cwd'));assert.deepEqual(loaded.errors,[]);
 const ext=loaded.extensions[0],ctx={sessionManager:manager};
 for(const fn of ext.handlers.get('session_start'))await fn({type:'session_start'},ctx);
 const def=ext.tools.get('todo').definition;
 const rewound=await def.execute('rewind',{action:'list'},undefined,undefined,ctx);
 assert.equal(rewound.details.todos[0].done,false,'real SessionManager rewind restores saved add state');
 // A fresh reconstruction followed immediately by toggle tests inbound ownership,
 // without a list call that could replace the latest returned snapshot first.
 const inboundManager=SessionManager.open(copied);inboundManager.branch(results[0].id);
 const inboundLoaded=await loadExtensions([autoloadedTodo],join(evidence,'cwd'));assert.deepEqual(inboundLoaded.errors,[]);
 const inboundExt=inboundLoaded.extensions[0],inboundCtx={sessionManager:inboundManager};
 for(const fn of inboundExt.handlers.get('session_start'))await fn({type:'session_start'},inboundCtx);
 await inboundExt.tools.get('todo').definition.execute('immediate-toggle',{action:'toggle',id:1},undefined,undefined,inboundCtx);
 const inboundHistoricalMutation=inboundManager.getBranch().find(e=>e.id===results[0].id).message.details.todos[0].done;
 launch();await drive({action:'clear'});await stop();
 launch();await drive({action:'list'});await stop();
 latest=readRows().filter(e=>e.message?.role==='toolResult'&&e.message.toolName==='todo').at(-1);
 assert.deepEqual(latest.message.details.todos,[],'cleared tasks stay absent after restart');
 const settingsPath=join(evidence,'agent/settings.json');
 const disabledSettings=JSON.parse(readFileSync(settingsPath,'utf8'));
 disabledSettings.extensions=['-./extensions/todo.ts'];
 writeFileSync(settingsPath,JSON.stringify(disabledSettings));
 launch();await drive(null);await stop();
 assert(!lastTools.includes('todo'),'existing extension exclusion disables TODO');
 assert(lastTools.includes('bash')&&lastTools.includes('codemode'),'disabling TODO preserves baseline tools');
 receipt={actualCli:true,autoload:true,defaultTools:['bash','codemode'],runtimePackage:pkg,todoSha256:createHash('sha256').update(readFileSync(autoloadedTodo)).digest('hex'),providerCalls,paidCalls:0,realRestartPassed:true,clearRestartPassed:true,disablePassed:true,durableInitialSnapshotPreserved:true,missingIdNonmutationPassed:true,secondToggleReopens:true,liveHistoricalMutation,inboundHistoricalMutation,sdkRewindPassed:true,sandbox:!!sandboxCommand,limits:'CLI loopback synthetic provider plus read-only live observer; SDK actual SessionManager rewind and immediate post-reconstruction toggle; no model adherence proof',errors};
 writeFileSync(join(evidence,'receipt.json'),JSON.stringify(receipt,null,2));
 assert.deepEqual(errors,[]);
 // Keep this assertion as meaningful RED if actual CLI history differs from disk.
 assert.equal(liveHistoricalMutation,false,'live historical add result must match its durable snapshot');
 assert.equal(inboundHistoricalMutation,false,'immediate post-reconstruction toggle must preserve saved history');
 console.log('PASS',JSON.stringify(receipt));
} finally {await stop();server.closeAllConnections();await new Promise(r=>server.close(r));}

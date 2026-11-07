// Abort a real RPC admission request, then retry in the same process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [source,cli,work,scenario='admission-init']=process.argv.slice(2);
let initializes=0,reads=0,inference=0,held,locked=false;
const teamDir=join(process.env.HOME,'.pi','t3-teams','teams',createHash('sha256').update('root-thread').digest('hex'));
const send=(res,body,result)=>{if(!res.destroyed){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));}};
const server=createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
 if(req.url==='/v1/chat/completions'){inference++;appendFileSync(join(work,'provider.jsonl'),JSON.stringify(body)+'\n');res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'RECOVERED'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);return;}
 assert.equal(req.headers.authorization,'Bearer synthetic');let result;
 if(body.method==='initialize'){initializes++;result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};if(scenario==='admission-init'&&initializes===1){held=()=>send(res,body,result);return;}}
 else if(body.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
 else{let data;if(body.params.name==='t3_thread_list')data={currentThreadId:'root-thread',threads:[]};else{reads++;data={thread:{threadId:'root-thread',parentThreadId:null,activeRunId:'root-run',providerInstanceId:'pi-local'}};}
 result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};
 if(body.params.name==='t3_thread_read'&&reads===1){
  if(scenario==='admission-discovery'){held=()=>send(res,body,result);return;}
  if(scenario==='admission-partial'){mkdirSync(teamDir,{recursive:true});mkdirSync(join(teamDir,'lock'));locked=true;}
 }}send(res,body,result);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',apiKey:'synthetic',baseUrl:`${base}/v1`,models:[{id:'fixture',input:['text'],contextWindow:100000,maxTokens:1000}]}}}));
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
const child=spawn(cli,['--mode','rpc','--no-extensions','--no-skills','--no-prompt-templates','--session',join(work,'session.jsonl'),'--provider','fixture','--model','fixture','-e',join(source,'pi-extension/subagents/index.ts'),'--t3'],{cwd:work,env:{...process.env,T3_MCP_URL:`${base}/mcp`,T3_MCP_BEARER_TOKEN:'synthetic'},stdio:['pipe','pipe','pipe']});
const records=[];let buffer='',sequence=0;
child.stdout.on('data',chunk=>{appendFileSync(join(work,'stdout.jsonl'),chunk);buffer+=chunk;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line.trim())records.push(JSON.parse(line));}});
child.stderr.on('data',chunk=>appendFileSync(join(work,'stderr.txt'),chunk));
async function until(check,label){const end=Date.now()+15000;for(;;){const value=check();if(value)return value;assert(Date.now()<end,`${label}; inspect ${work}`);await new Promise(r=>setTimeout(r,10));}}
async function command(type,fields={}){const id=String(++sequence);child.stdin.write(JSON.stringify({id,type,...fields})+'\n');return until(()=>records.find(r=>r.id===id),type);}
try{
 assert.equal((await command('get_state')).success,true);
 const first=command('prompt',{message:'FIRST_MUST_NOT_RUN'});
 await until(()=>scenario==='admission-partial'?existsSync(join(teamDir,'root-claim')):held,'first admission reaches injected boundary');
 assert.equal((await command('abort')).success,true);assert.equal((await first).success,false);assert.equal(inference,0);
 held?.();
 let incarnation;
 if(locked){rmSync(join(teamDir,'lock'),{recursive:true});locked=false;await until(()=>existsSync(join(teamDir,'state.json'))&&JSON.parse(readFileSync(join(teamDir,'state.json'),'utf8')).members.root,'partial registration completes without inference');incarnation=JSON.parse(readFileSync(join(teamDir,'state.json'),'utf8')).members.root.incarnation;}
 const second=await command('prompt',{message:'SECOND_MUST_RUN'});
 if(scenario==='admission-partial'){
  assert.equal(second.success,false,'partly claimed admission is not blindly replayed');assert.equal(reads,1);assert.equal(inference,0);assert.equal(JSON.parse(readFileSync(join(teamDir,'state.json'),'utf8')).members.root.incarnation,incarnation);
 }else{
  assert.equal(second.success,true,'fresh prompt must recover from failed pre-admission work');await until(()=>records.some(r=>r.type==='agent_settled'),'recovered turn');assert.equal(inference,1,'only the new request infers');
  assert.equal(initializes,scenario==='admission-init'?2:1);assert.equal(reads,scenario==='admission-discovery'?2:1);
  const entries=(await command('get_entries')).data.entries;const users=entries.filter(e=>e.message?.role==='user').map(e=>JSON.stringify(e.message.content));assert(users.some(t=>t.includes('SECOND_MUST_RUN')));assert(!users.some(t=>t.includes('FIRST_MUST_NOT_RUN')));
 }
 console.log(`PASS ${scenario}: cancellation-safe pre-admission retry boundary`);
}finally{held?.();if(locked)rmSync(join(teamDir,'lock'),{recursive:true});child.stdin.end();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(()=>child.kill('SIGKILL'),1500).unref();});server.closeAllConnections();await new Promise(r=>server.close(r));}

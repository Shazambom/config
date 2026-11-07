// Real CLI flag/mode/admission controls. No user credentials or deployed state.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const [source, cli, work, unpatched] = process.argv.slice(2);
let inference = 0, discovery = 0;
const server = createServer(async (req,res) => {
 let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
 if(req.url==='/v1/chat/completions'){
  inference++;res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'NORMAL_INPUT'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);return;
 }
 discovery++;assert.equal(req.headers.authorization,'Bearer synthetic');let result;
 if(body.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 else if(body.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
 else{const data=body.params.name==='t3_thread_list'?{currentThreadId:'root-thread',threads:[]}:{thread:{threadId:'root-thread',parentThreadId:null,activeRunId:'root-run',providerInstanceId:'pi-local'}};result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',apiKey:'synthetic',baseUrl:`${base}/v1`,models:[{id:'fixture',input:['text'],contextWindow:100000,maxTokens:1000}]}}}));
const clients=[];
function start(name,{flag=true,print=false,persisted=false,binary=cli,env={}}={}){
 const cwd=join(work,name);mkdirSync(cwd);
 const args=[...(print?['--print']:['--mode','rpc']),...(persisted?['--session',join(cwd,'session.jsonl')]:['--no-session']),'--no-extensions','--no-skills','--no-prompt-templates','--provider','fixture','--model','fixture','-e',join(source,'pi-extension/subagents/index.ts'),...(flag?['--t3']:[]),...(print?['MUST_NOT_INFER']:[])];
 const child=spawn(binary,args,{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});clients.push(child);if(print)child.stdin.end();
 const records=[];let stdout='',stderr='',pending='',id=0;
 child.stdout.on('data',chunk=>{stdout+=chunk;appendFileSync(join(cwd,'stdout.txt'),chunk);if(print)return;pending+=chunk;for(;;){const i=pending.indexOf('\n');if(i<0)break;const line=pending.slice(0,i);pending=pending.slice(i+1);if(line.trim())records.push(JSON.parse(line));}});
 child.stderr.on('data',chunk=>{stderr+=chunk;appendFileSync(join(cwd,'stderr.txt'),chunk);});
 const until=async(check,label)=>{const end=Date.now()+10000;for(;;){const value=check();if(value)return value;assert(Date.now()<end,`${name}: ${label}`);await new Promise(r=>setTimeout(r,10));}};
 async function command(type,fields={}){const requestId=String(++id);child.stdin.write(JSON.stringify({id:requestId,type,...fields})+'\n');return until(()=>records.find(r=>r.id===requestId),type);}
 return{child,records,command,until,output:()=>stdout+stderr};
}
try{
 const offline=start('offline');
 for(const type of ['get_state','get_entries','get_available_models'])assert.equal((await offline.command(type)).success,true,'offline discovery remains usable');
 assert.equal((await offline.command('set_model',{provider:'fixture',modelId:'fixture'})).success,true);
 const refused=await offline.command('prompt',{message:'MUST_NOT_INFER'});assert.equal(refused.success,false);assert.match(refused.error,/authenticated context/);assert.equal(inference,0);
 const nonRpc=start('non-rpc',{print:true});await nonRpc.until(()=>nonRpc.child.exitCode!==null,'clear unsupported-mode exit');assert.match(nonRpc.output(),/requires RPC mode/);assert.equal(inference,0,'unsupported mode cannot call provider');
 if(unpatched){const old=start('unpatched',{binary:unpatched});old.child.stdin.write(JSON.stringify({id:'probe',type:'get_state'})+'\n');await old.until(()=>old.child.exitCode!==null,'missing-capability refusal');assert.match(old.output(),/rpc_ready runtime patch/);assert.equal(inference,0);}
 const normal=start('normal',{flag:false,env:{T3_MCP_URL:`${base}/mcp`,T3_MCP_BEARER_TOKEN:'synthetic'}});
 assert.equal((await normal.command('prompt',{message:'NORMAL_INPUT'})).success,true);await normal.until(()=>normal.records.some(r=>r.type==='agent_settled'),'ordinary prompt');assert.equal(inference,1);assert.equal(discovery,0,'T3 environment does not opt in without --t3');
 const inherited=start('inherited',{persisted:true,env:{T3_MCP_URL:`${base}/mcp`,T3_MCP_BEARER_TOKEN:'synthetic',PI_LIFECYCLE_OWNER:'synthetic-invalid-owner'}});
 const denied=await inherited.command('prompt',{message:'MUST_NOT_INFER'});assert.equal(denied.success,false);assert.match(denied.error,/inherited terminal worker ownership/);assert.equal(inference,1);
 console.log('PASS explicit opt-in, offline discovery, unsupported mode/capability, missing context and inherited-owner refusal');
}finally{for(const p of clients)p.stdin.end();await Promise.all(clients.map(p=>new Promise(r=>{if(p.exitCode!==null)return r();p.once('exit',r);setTimeout(()=>p.kill('SIGKILL'),1000).unref();})));server.closeAllConnections();await new Promise(r=>server.close(r));}

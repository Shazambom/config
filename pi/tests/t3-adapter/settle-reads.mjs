// Component counter over the real adapter and TeamStore; RPC behavior has separate fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';
const [sourceArg,work]=process.argv.slice(2);const source=realpathSync(sourceArg);
const jiti=createJiti(import.meta.url,{alias:{'@mariozechner/pi-coding-agent':import.meta.resolve('@earendil-works/pi-coding-agent').replace('file://',''),'@sinclair/typebox':import.meta.resolve('typebox').replace('file://','')}});const {installT3}=await jiti.import(join(source,'pi-extension/subagents/t3-adapter.ts'));const {TeamStore}=await jiti.import(join(source,'pi-extension/subagents/team.ts'));
const hash=s=>createHash('sha256').update(s).digest('hex');
let current,queued=false,waits=0,reads=0,counting=false;
const originalState=TeamStore.prototype.state;
TeamStore.prototype.state=function(){if(counting&&new Error().stack?.includes('refreshTerminal'))reads++;return originalState.call(this);};
const server=createServer(async(req,res)=>{let raw='';for await(const p of req)raw+=p;const body=JSON.parse(raw);let result;
 if(body.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 else if(body.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
 else{let data;if(body.params.name==='t3_thread_list')data={currentThreadId:current,threads:[]};else if(body.params.name==='t3_thread_read')data={thread:{threadId:current,parentThreadId:'root-thread',activeRunId:`${current}-run`,providerInstanceId:'fixture'}};else{assert.equal(body.params.name,'t3_thread_wait');waits++;if(waits===3)queued=true;data={threadId:body.params.arguments.threadId,runId:body.params.arguments.runId,status:'running',timedOut:true};}result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.T3_MCP_URL=`http://127.0.0.1:${server.address().port}`;process.env.T3_MCP_BEARER_TOKEN='synthetic';
const profile={tools:'read',subagentAgents:['leaf'],body:'fixture'};
const evidence=[];
try{for(const mode of ['exact','missing','mismatch']){
 current=`coordinator-${mode}`;queued=false;waits=0;reads=0;
 const dir=join(work,mode);const store=TeamStore.create(dir);await store.register({id:'root',name:'root',parent:null,live:true});await store.register({id:current,name:'coordinator',parent:'root',live:true,t3:{taskId:`task-${current}`,runId:`${current}-run`,status:'running',claimed:false}});
 const binding={taskId:`task-${current}`,childThreadId:current,childRunId:`${current}-run`,parentThreadId:'root-thread',dir,agent:'coordinator',profileHash:hash(JSON.stringify(profile)),model:'fixture/model'};
 const bindingDir=join(process.env.HOME,'.pi','t3-teams','bindings');mkdirSync(bindingDir,{recursive:true});writeFileSync(join(bindingDir,`${hash(current)}.json`),JSON.stringify(binding));
 const handlers=new Map(),tools=new Map(['read','subagent','subagents_list','mcp__t3-code__delegate_task','mcp__t3-code__task_status'].map(name=>[name,{name}]));let active=[...tools.keys()],next=0;
 const pi={registerFlag(){},getFlag:()=>true,on(name,fn){const list=handlers.get(name)??[];list.push(fn);handlers.set(name,list);},events:{emit(){}},registerTool(t){tools.set(t.name,t);},getAllTools:()=>[...tools.values()],getActiveTools:()=>active,setActiveTools:names=>{active=names;},setModel:async()=>true,setThinkingLevel(){},appendEntry(){},sendMessage(){throw new Error('No model keepalive expected');}};
 const team={isAdmitted:()=>true,hasQueuedInput:()=>false,start:async()=>{},fence:async()=>{},fenceIfQuiet:async()=>{throw new Error('running work must not retire');}};
 const model={provider:'fixture',id:'model'};const ctx={mode:'rpc',rpcReadiness:true,ui:{notify(){},input(){}},shutdown(){},sessionManager:{getSessionFile:()=>resolve(dir,'session.jsonl')},modelRegistry:{getAll:()=>[model]},hasPendingMessages:()=>queued,executeTool:async(name)=>{assert.equal(name,'mcp__t3-code__delegate_task');const n=++next;const task={taskId:`${mode}-task-${n}`,childThreadId:`${mode}-child-${n}`,childRunId:`${mode}-run-${n}`,status:'running'};return {isError:false,result:{content:[{type:'text',text:JSON.stringify(task)}]}};}};
 const adapter=installT3(pi,{load:name=>name==='coordinator'?profile:{tools:'read',body:'leaf'},names:()=>['coordinator','leaf']},team);
 for(const fn of handlers.get('session_start'))await fn({},ctx);
 const signal=new AbortController().signal;for(const fn of handlers.get('rpc_ready'))await fn({command:'prompt',phase:'before_dispatch',signal},ctx);
 const launched=[];for(let n=1;n<=3;n++)launched.push((await adapter.launch(`call-${n}`,{agent:'leaf',name:`leaf-${n}`,task:'task',model:'fixture/model'},ctx,signal)).details);
 for(const task of launched.slice(0,2)){await store.update(task.childThreadId,{live:false,t3:{taskId:task.taskId,runId:task.childRunId,status:'completed',claimed:true}});for(const fn of handlers.get('tool_result'))await fn({toolName:'mcp__t3-code__task_status',input:{taskId:task.taskId},isError:false,content:[{type:'text',text:JSON.stringify({...task,status:'completed'})}]},ctx);}
 if(mode==='missing')await store.transaction(s=>{delete s.members[launched[1].childThreadId];});
 if(mode==='mismatch')await store.transaction(s=>{s.members[launched[1].childThreadId].t3.runId='different-run';});
 counting=true;for(const fn of handlers.get('agent_before_settle'))assert.equal(await fn({signal},ctx),undefined);counting=false;
 evidence.push({mode,waits,refreshStateReads:reads});assert.equal(waits,3);assert.equal(reads,mode==='exact'?3:6,'skip only exact terminal snapshot matches; missing/mismatched rows still refresh');
 for(const fn of handlers.get('session_shutdown'))await fn({},ctx);
}console.log('PASS settlement read counter: completed cohorts skipped, uncertain/running work refreshed, queued input releases hold');}
finally{counting=false;TeamStore.prototype.state=originalState;writeFileSync(join(work,'state-read-counts.json'),JSON.stringify(evidence,null,2));server.closeAllConnections();await new Promise(r=>server.close(r));}

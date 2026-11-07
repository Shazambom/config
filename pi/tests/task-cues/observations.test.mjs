import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import install from '../../agent/task-cues/index.ts';
import {project,canonicalEntries,cueText,scalar,observationType} from '../../agent/task-cues/observations.mjs';
const observation=(phase,id,parent=null,name='write')=>({type:'custom',customType:observationType,id,parentId:null,data:{session_id:'s',tool_call_id:'c',parent_tool_call_id:parent,phase,tool_name:name,attempted_target:null,reported_error:phase==='attempted'?null:false}});
const saved=entries=>({entries:new Map(entries.map(e=>[e.id,e])),gaps:new Set()});
for(let attempts=0;attempts<=2;attempts++)for(let results=0;results<=2;results++)test(`pair counts ${attempts}/${results}`,()=>{
 const entries=[...Array.from({length:attempts},(_,n)=>observation('attempted','a'+n)),...Array.from({length:results},(_,n)=>observation('reported-result','r'+n))];
 const p=project(entries,saved(entries),'s');
 assert.equal(p.paired,attempts===1&&results===1?1:0);
 assert.equal(p.outcome,attempts===1&&results===1?'recorded-results-only':'unknown');
});
test('only same entry dedup; different parent/name/session cannot pair',()=>{
 const a=observation('attempted','a'), r=observation('reported-result','r');
 assert.equal(project([a,a,r,r],saved([a,r]),'s').paired,1);
 for(const bad of [observation('reported-result','r','nested'),observation('reported-result','r',null,'edit'),{...r,data:{...r.data,session_id:'other'}}])assert.equal(project([a,bad],saved([a,bad]),'s').paired,0);
});
test('saved/live are one observation; ghost append is not saved proof',()=>{
 const a=observation('attempted','a'),r=observation('reported-result','r');
 const p=project([a,r],saved([a]),'s');
 assert.equal(p.paired,1);assert.equal(p.outcome,'unknown');assert.equal(p.lastResult.source,'live-only');
});
test('transcript crosschecks without doubling actual attempt; uncovered calls unknown',()=>{
 const entries=[{type:'message',id:'m',message:{role:'assistant',content:[{type:'toolCall',id:'c',name:'write'}]}},observation('attempted','a'),observation('reported-result','r'),{type:'message',id:'t',message:{role:'toolResult',toolCallId:'c',toolName:'write'}}];
 assert.equal(project(entries,saved(entries),'s').paired,1);
 assert.equal(project(entries,saved(entries),'s').unresolved,0);
 assert.equal(project([entries[0]],saved(entries),'s').unresolved,1);
});
test('canonical corruption is read-only and yields unknown, not skipped-success',()=>{
 const dir=mkdtempSync(join(tmpdir(),'task-cue-'));try{
 const file=join(dir,'session.jsonl'),a=observation('attempted','a'),r=observation('reported-result','r');
 const raw=JSON.stringify({type:'session',id:'s',version:3})+'\n'+JSON.stringify(a)+'\n'+JSON.stringify(r)+'\n{"partial":';
 writeFileSync(file,raw);
 const p=project([a,r],canonicalEntries(file,'s'),'s');assert.equal(p.outcome,'unknown');assert.equal(readFileSync(file,'utf8'),raw);
 assert.equal(project([a,r],canonicalEntries(file+'.missing','s'),'s').outcome,'unknown');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('safe bounded cue excludes target/prose/output; latest result preserves order',()=>{
 const a=observation('attempted','a'),r=observation('reported-result','r');a.data.tool_name=r.data.tool_name='\n\u202e'+ '💥'.repeat(1000);a.data.attempted_target=null;
 const p=project([a,r],saved([a,r]),'s'),text=cueText(p);
 assert(Array.from(text).length<=1200);assert(!text.includes('\u202e'));assert(text.includes('…'));assert.equal(p.lastResult.entryId,'r');assert(!scalar('a\nb').includes('\n'));
});
function fixture(){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'task-cue-'))),file=join(dir,'s.jsonl');
 writeFileSync(file,JSON.stringify({type:'session',version:3,id:'s'})+'\n');
 const handlers={},entries=[];let identity={status:'root',sessionFile:file},owner={managed:true,status:'owned',sessionFile:file,generation:'g'},repeat=false,fail=false;
 const pi={on:(name,fn)=>{handlers[name]=fn;},events:{emit:(name,{respond})=>{respond(name==='subagents:identity'?identity:owner);if(repeat)respond(identity);}},appendEntry:(type,data)=>{const e={type:'custom',customType:type,id:String(entries.length),data};entries.push(e);if(fail)throw Error('synthetic');}};
 const ctx={sessionManager:{getSessionFile:()=>file,getSessionId:()=>'s',getBranch:()=>entries}};
 install(pi);handlers.session_start();
 return {handlers,ctx,entries,file,close:()=>rmSync(dir,{recursive:true,force:true}),setIdentity:x=>identity=x,setOwner:x=>owner=x,setRepeat:()=>repeat=true,setFail:()=>fail=true};
}
test('preserve every original object/order; no root inference; pin generation; context failure passes through',()=>{
 const f=fixture();try{
 const messages=[{role:'user',content:[{type:'image',data:'original'}]},{role:'custom',customType:'task-cue',content:'foreign original'},{role:'toolResult',toolCallId:'x'}];
 const run=()=>f.handlers.context({messages},f.ctx);
 const output=run().messages;assert.equal(output.length,4);messages.forEach((m,i)=>assert.equal(output[i],m));assert.equal(messages.length,3);
 f.setOwner({managed:true,status:'owned',sessionFile:f.file,generation:'changed'});assert.equal(run().messages,messages);
 f.handlers.session_start();f.setIdentity({status:'child',sessionFile:f.file});assert.equal(run().messages,messages);
 f.setIdentity({status:'unknown'});assert.equal(run().messages,messages);
 f.setIdentity({status:'root',sessionFile:f.file+'.stale'});assert.equal(run().messages,messages);
 f.setIdentity({status:'root',sessionFile:f.file});f.setRepeat();assert.equal(run().messages,messages);
 }finally{f.close();}
});
test('append error ghosts stay unknown; forbidden arguments never recorded; branch failure unchanged',()=>{
 const f=fixture();try{
 f.setFail();f.handlers.tool_execution_start({type:'tool_execution_start',toolCallId:'c',toolName:'bash',args:{command:'SECRET'}},f.ctx);
 assert(!JSON.stringify(f.entries).includes('SECRET'));
 const messages=[{role:'user',content:'task'}];const output=f.handlers.context({messages},f.ctx).messages;
 assert(output.at(-1).content.includes('unknown'));assert(output.at(-1).content.includes('explicit unresolved observation identities=1'));
 f.ctx.sessionManager.getBranch=()=>{throw Error('read failure');};assert.equal(f.handlers.context({messages},f.ctx).messages,messages);
 }finally{f.close();}
});

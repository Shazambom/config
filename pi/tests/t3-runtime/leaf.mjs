import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Script decisions are based on actual provider input. No native MCP API is mocked.
export function leafFixture(work, reply) {
  let rootId, spawned=false, pingAnswered=false, attemptedLate=false, completionObserved=false, childRequests=0;
  const tool=(name,args)=>({tool:name,args});
  const dir=()=>join(work,'home/.pi/t3-teams/teams',createHash('sha256').update(rootId).digest('hex'));
  const audit=()=>rootId&&existsSync(join(dir(),'messages.jsonl'))?readFileSync(join(dir(),'messages.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  function decide(input) {
    const text=JSON.stringify(input.messages);
    const child=text.includes('BOUND_LEAF_PROFILE');
    if(child) {
      childRequests++;
      assert(input.messages.some(m=>m.role==='user'&&(m.content==='CHILD_NATIVE_TASK'||Array.isArray(m.content)&&m.content.some(p=>p.text==='CHILD_NATIVE_TASK'))),'exact child task reached real child provider');
      const tools=input.tools.map(t=>t.function.name);
      assert(tools.includes('read')&&tools.includes('team_send'),'profile and peer tools available');
      assert(tools.every(t=>['read','team_send','load_workflow','ask_question'].includes(t)),'child profile tool allowlist enforced');
      if(!input.messages.some(m=>m.role==='tool'))return tool('team_send',{to:'parent',message:'PEER_PING',wait_for_reply:true});
      assert(text.includes('PEER_REPLY'),'leaf must receive parent reply before finishing');
      return {text:'CHILD_NATIVE_RESULT'};
    }
    if(!spawned){spawned=true;return tool('subagent',{agent:'proof-leaf',name:'proof-leaf',task:'CHILD_NATIVE_TASK'});}
    if(text.includes('PEER_PING')&&!pingAnswered) {
      const ping=audit().find(m=>m.message==='PEER_PING');
      assert(ping,'model-visible ping must have root audit');
      pingAnswered=true;
      return tool('team_send',{to:'proof-leaf',message:'PEER_REPLY',reply_to:ping.id});
    }
    const nativeCompletion=input.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('Delegated task ')&&JSON.stringify(m.content).includes('[completed]')&&JSON.stringify(m.content).includes('CHILD_NATIVE_RESULT'));
    if(nativeCompletion) {
      completionObserved=true;
      if(!attemptedLate){attemptedLate=true;return tool('team_send',{to:'proof-leaf',message:'POST_COMPLETION_MUST_REJECT'});}
      const lastTool=input.messages.filter(m=>m.role==='tool').at(-1);
      assert(lastTool&&/not live|not deliverable|no live|not found|not a live|completed|inactive|unavailable/i.test(JSON.stringify(lastTool)),'post-completion DM must return a rejection');
      return {text:reply};
    }
    return {text:'ROOT_WAITING_FOR_NATIVE_CHILD'};
  }
  function verify(alive) {
    assert(completionObserved,'native child completion reached parent model');
    assert(childRequests>=2,'real child had model requests before and after peer reply');
    const messages=audit();
    const ping=messages.find(m=>m.message==='PEER_PING');
    const answer=messages.find(m=>m.message==='PEER_REPLY');
    assert(ping&&answer,'peer exchange recorded');
    assert.equal(answer.reply_to,ping.id);
    assert(ping.recipients.includes('root')&&answer.recipients.includes('root'),'both messages root-audited');
    assert.equal(answer.from,'root');
    assert(!messages.some(m=>m.message==='POST_COMPLETION_MUST_REJECT'),'rejected DM must not enter audit');
    const state=JSON.parse(readFileSync(join(dir(),'state.json'),'utf8'));
    const child=state.members[ping.from];
    assert(child,'native child member registered');
    assert(alive(child.pid),'completed native leaf process retained alive');
    assert.equal(child.deliverable,false);
    return {rootId,childThreadId:ping.from,childPid:child.pid,completionObserved,childRequests,auditDirectory:dir(),retainedChildAlive:true};
  }
  return {decide,verify,setRoot:id=>{rootId=id;}};
}

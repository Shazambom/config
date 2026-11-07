// Native question/steering proof. The scripted endpoint never answers RPC/UI directly.
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export function controlsFixture(work,reply) {
  mkdirSync(join(work,'agent/agents'),{recursive:true});
  const profile='---\nname: proof-control\ndescription: Native controls proof\ntools: read\nsystem-prompt: append\n---\nCONTROL_LEAF_PROFILE\n';
  writeFileSync(join(work,'agent/agents/proof-control.md'),profile);
  if(process.env.CONFIG_PI_RUNTIME_DIR)writeFileSync(join(process.env.CONFIG_PI_RUNTIME_DIR,'../repo/pi/agent/agents/proof-control.md'),profile);
  let rootId,launched=false,requestId,answered=false,steered=false,staleAttempted=false,staleRejected=false,childRequests=0,questionObserved=false,steeringObserved=false,childFinished=false;
  let release;const steeringReceipt=new Promise(resolve=>{release=resolve;});
  const call=(tool,args)=>({tool,args});
  const text=messages=>JSON.stringify(messages);
  async function decide(input) {
    const transcript=text(input.messages);
    if(transcript.includes('CONTROL_LEAF_PROFILE')) {
      assert(!childFinished,'completed child must not receive stale-answer inference');
      assert(!transcript.includes('STALE_ANSWER_MUST_NOT_DELIVER'));
      childRequests++;
      assert(!input.tools.some(t=>t.function.name==='team_send'),'team OFF does not acquire peer chat');
      assert(input.tools.some(t=>t.function.name==='ask_question'),'control question remains available with team OFF');
      if(!input.messages.some(m=>m.role==='tool'))return call('ask_question',{question:'CONTROL_QUESTION_TEXT'});
      assert(transcript.includes('CONTROL_ANSWER_TEXT'),'native UI answer reached child model');
      if(!transcript.includes('CONTROL_STEER_TEXT')) {
        await Promise.race([steeringReceipt,new Promise((_,reject)=>setTimeout(()=>reject(new Error('native steering receipt timeout')),15000).unref())]);
        return {text:'CHILD_PROCESSED_ANSWER'};
      }
      steeringObserved=true;childFinished=true;return {text:'CHILD_CONTROL_DONE'};
    }
    if(!launched){launched=true;return call('subagent',{agent:'proof-control',name:'proof-control',task:'CONTROL_CHILD_TASK'});}
    if(!answered&&transcript.includes('CONTROL_QUESTION_TEXT')) {
      const match=transcript.match(/requestId: ([^\\\s"]+)/);
      assert(match,'parent received actual native user-input request ID');requestId=match[1];questionObserved=true;answered=true;
      return call('subagent_message',{name:'proof-control',requestId,message:'CONTROL_ANSWER_TEXT'});
    }
    if(answered&&!steered&&transcript.includes('Answered user question')) {
      steered=true;return call('subagent_message',{name:'proof-control',message:'CONTROL_STEER_TEXT'});
    }
    if(steered&&input.messages.some(m=>m.role==='tool'&&/steer/i.test(text(m))))release();
    if(transcript.includes('Delegated task ')&&transcript.includes('[completed]')&&transcript.includes('CHILD_CONTROL_DONE')) {
      if(!staleAttempted){staleAttempted=true;return call('subagent_message',{name:'proof-control',requestId,message:'STALE_ANSWER_MUST_NOT_DELIVER'});}
      const last=input.messages.filter(m=>m.role==='tool').at(-1);
      assert(/no longer deliverable|not pending|completed|retired/i.test(text(last)),'stale answer refused without new assignment');staleRejected=true;
      return {text:reply};
    }
    return {text:'ROOT_WAITING_FOR_NATIVE_CONTROLS'};
  }
  function verify(alive) {
    const dir=join(work,'home/.pi/t3-teams/teams',createHash('sha256').update(rootId).digest('hex'));
    const state=JSON.parse(readFileSync(join(dir,'state.json'),'utf8'));
    const children=Object.values(state.members).filter(m=>m.parent!==null);
    assert.equal(state.desired,false);assert.equal(children.length,1,'stale answer did not create a new child');
    assert(questionObserved&&answered&&steeringObserved&&staleRejected);
    assert.equal(children[0].deliverable,false);assert.equal(children[0].live,false);
    assert(!existsSync(join(dir,'messages.jsonl')),'question/steering did not masquerade as peer chat');
    const native=execFileSync('sqlite3',[join(work,'state/userdata/statev2.sqlite'),"select payload_json from orchestration_events where event_type='runtime-request.updated' order by sequence;"],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.id===requestId);
    assert(native.some(r=>r.kind==='user_input'&&r.status==='pending'),'actual native user-input request existed');
    assert.equal(native.at(-1).status,'resolved','stale answer did not reopen native request');
    return {nativeRequestKind:'user_input',nativeRequestFinalStatus:native.at(-1).status,rootId,childThreadId:children[0].id,childPid:children[0].pid,requestId,questionObserved,steeringObserved,staleRejected,childRequests,teamDesired:state.desired,retainedChildAlive:alive(children[0].pid)};
  }
  return {decide,verify,setRoot:id=>{rootId=id;}};
}

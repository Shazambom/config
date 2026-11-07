// Same-thread reassignment must retain actual child history, not reconstruct it.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync,readdirSync,realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
export function resumeFixture(work,reply) {
  const marker=`PRIVATE_HISTORY_${randomUUID()}`;
  const firstTask=`Remember this private marker without repeating it in your final response: ${marker}. Ask the parent whether you may finish, then finish.`;
  const followup='Use the private marker from your earlier assignment to produce the requested retained-history result.';
  const parentTask='PARENT_REQUEST_REASSIGNMENT';
  mkdirSync(join(work,'agent/agents'),{recursive:true});
  writeFileSync(join(work,'agent/agents/proof-resume.md'),'---\nname: proof-resume\ndescription: Retained native history proof\ntools: read\nsystem-prompt: append\n---\nRESUME_LEAF_PROFILE\n');
  let rootId,started=false,requestId,answered=false,first,firstBinding,lateDm=false,stale=false,reassigned=false,resumedCalls=0,firstCalls=0;
  const tool=(tool,args)=>({tool,args});
  const state=()=>JSON.parse(readFileSync(join(work,'home/.pi/t3-teams/teams',createHash('sha256').update(rootId).digest('hex'),'state.json'),'utf8'));
  const member=()=>Object.values(state().members).find(m=>m.parent==='root');
  const exactUser=(input,value)=>input.messages.some(m=>m.role==='user'&&(m.content===value||Array.isArray(m.content)&&m.content.some(p=>p.text===value)));
  function decide(input){
    const text=JSON.stringify(input.messages);
    if(text.includes('RESUME_LEAF_PROFILE')) {
      assert(!text.includes('LATE_DM_NO_AUTHORITY')&&!text.includes('STALE_ANSWER_NO_AUTHORITY'),'peer/stale-answer paths cannot inject a new assignment');
      if(exactUser(input,followup)) {
        resumedCalls++;assert.equal(resumedCalls,1,'follow-up inferred exactly once');
        assert(exactUser(input,firstTask),'actual original private task remains in child context');
        assert(text.includes(marker),'private history was preserved');
        assert(input.messages.some(m=>m.role==='assistant'&&JSON.stringify(m.content).includes('FIRST_CHILD_FINISHED')),'first child assistant history preserved');
        return {text:`RETAINED_HISTORY_RESULT ${marker}`};
      }
      firstCalls++;assert(exactUser(input,firstTask),'first task delivered exactly');
      if(!input.messages.some(m=>m.role==='tool'))return tool('ask_question',{question:'RESUME_FIRST_QUESTION'});
      assert(text.includes('FIRST_ANSWER'));return {text:'FIRST_CHILD_FINISHED'};
    }
    if(!started){started=true;return tool('subagent',{agent:'proof-resume',name:'proof-resume',task:firstTask});}
    if(!answered&&text.includes('RESUME_FIRST_QUESTION')) {
      requestId=text.match(/requestId: ([^\\\s"]+)/)?.[1];assert(requestId);answered=true;
      return tool('subagent_message',{name:'proof-resume',requestId,message:'FIRST_ANSWER'});
    }
    if(!text.includes(parentTask)) {
      if(text.includes('Delegated task ')&&text.includes('[completed]')&&text.includes('FIRST_CHILD_FINISHED'))return {text:'FIRST_ROOT_DONE'};
      return {text:'ROOT_WAITING_FIRST_CHILD'};
    }
    assert(first,'explicit new parent run follows verified first completion');
    if(!lateDm){lateDm=true;return tool('team_send',{to:'proof-resume',message:'LATE_DM_NO_AUTHORITY'});}
    if(!stale){
      assert(/completed|not live|retired|not deliverable/i.test(JSON.stringify(input.messages.filter(m=>m.role==='tool').at(-1))));
      stale=true;return tool('subagent_message',{name:'proof-resume',requestId,message:'STALE_ANSWER_NO_AUTHORITY'});
    }
    if(!reassigned){
      assert(/no longer deliverable|not pending|completed|retired/i.test(JSON.stringify(input.messages.filter(m=>m.role==='tool').at(-1))));
      reassigned=true;return tool('subagent_message',{name:'proof-resume',message:followup});
    }
    if(text.includes('RETAINED_HISTORY_RESULT '+marker)&&text.includes('Delegated task '))return {text:reply};
    const last=input.messages.filter(m=>m.role==='tool').at(-1);
    if(last&&/not yet supported|resume.*unsupported|new assignment.*unsupported|not implemented|pending same-thread rebind/i.test(JSON.stringify(last)))return {text:'RESUME_EXPECTED_RED_REFUSAL'};
    return {text:'ROOT_WAITING_REASSIGNED_CHILD'};
  }
  function firstComplete(alive){
    const m=member();assert(m&&m.live===false&&m.deliverable===false,'first assignment logically complete');
    assert(alive(m.pid),'native provider retained before explicit reassignment');
    first=JSON.parse(JSON.stringify(m));writeFileSync(join(work,'resume-first-member.json'),JSON.stringify(first,null,2));
    const matches=assignments().filter(b=>b.taskId===first.t3.taskId&&b.childRunId===first.t3.runId);
    assert.equal(matches.length,1,'first assignment has exact native binding');firstBinding=matches[0];
  }
  function assignments(){
    const directory=join(work,'home/.pi/t3-teams/assignments');
    return readdirSync(directory).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(join(directory,name),'utf8'))).filter(b=>b.parentThreadId===rootId);
  }
  function verify(){
    assert.equal(resumedCalls,1,'same-thread follow-up actually reached provider');
    const bindings=assignments().filter(b=>b.resumeFrom?.taskId===first.t3.taskId&&b.resumeFrom?.runId===first.t3.runId);
    assert.equal(bindings.length,1,'exactly one new assignment binds the completed task/run');
    const binding=bindings[0];assert.equal(binding.childThreadId,firstBinding.childThreadId,'same native child thread');
    const members=Object.values(state().members).filter(m=>m.parent!==null);
    const matches=members.filter(m=>m.t3?.taskId===binding.taskId&&m.t3?.runId===binding.childRunId);
    assert.equal(matches.length,1,'new member selected by exact native task/run');
    const next=matches[0];assert.equal(next.id,binding.memberId);
    const old=members.find(m=>m.id===first.id);assert(old,'retired assignment retained for audit');
    assert.equal(old.live,false);assert.equal(old.deliverable,false);assert.equal(old.incarnation,first.incarnation);
    const sessionFile=realpathSync(first.t3.sessionFile);
    assert.equal(realpathSync(next.t3.sessionFile),sessionFile,'same canonical Pi history file');
    assert.equal(realpathSync(binding.resumeFrom.sessionFile),sessionFile,'binding preserves canonical history');
    const nativeThreads=[...new Set(execFileSync('sqlite3',[join(work,'state/userdata/statev2.sqlite'),"select stream_id from orchestration_events where event_type='thread.created';"],{encoding:'utf8'}).trim().split('\n').filter(id=>id&&id!==rootId))];
    assert.deepEqual(nativeThreads,[firstBinding.childThreadId],'actual T3 records contain one child thread, not a fresh substitute');
    assert.notEqual(next.incarnation,first.incarnation,'fresh assignment membership');
    assert.notEqual(next.t3.taskId,first.t3.taskId,'new owned task');assert.notEqual(next.t3.runId,first.t3.runId,'new child run');
    assert.equal(next.live,false);assert.equal(next.deliverable,false);
    return {childThreadId:binding.childThreadId,nativeChildThreadCount:nativeThreads.length,sessionFile,firstMemberId:first.id,nextMemberId:next.id,oldAssignmentRetired:true,firstTaskId:first.t3.taskId,nextTaskId:next.t3.taskId,firstRunId:first.t3.runId,nextRunId:next.t3.runId,firstPid:first.pid,nextPid:next.pid,firstIncarnation:first.incarnation,nextIncarnation:next.incarnation,firstCalls,resumedCalls,lateDmRejected:lateDm,staleAnswerRejected:stale,retainedPrivateHistory:true};
  }
  return {decide,firstComplete,verify,parentTask,setRoot:id=>{rootId=id;}};
}

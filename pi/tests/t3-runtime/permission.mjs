// Reads only synthetic orchestration events, never auth tables or token files.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export function permissionFixture(work,reply) {
  const file=join(work,'workspace/PERMISSION_MUST_NOT_WRITE');
  mkdirSync(join(work,'agent/agents'),{recursive:true});
  writeFileSync(join(work,'agent/agents/proof-permission.md'),'---\nname: proof-permission\ndescription: Approval refusal proof\ntools: fixture_approval_write\nsystem-prompt: append\n---\nPERMISSION_LEAF_PROFILE\n');
  let rootId,launched=false,attempted=false,refused=false,approval,childRequests=0;
  const state=()=>JSON.parse(readFileSync(join(work,'home/.pi/t3-teams/teams',createHash('sha256').update(rootId).digest('hex'),'state.json'),'utf8'));
  const child=()=>Object.values(state().members).find(m=>m.parent==='root');
  function events(){
    const sql="select json_object('sequence',sequence,'threadId',stream_id,'eventType',event_type,'data',json(payload_json)) from orchestration_events where event_type in ('runtime-request.updated','turn-item.updated') order by sequence;";
    return execFileSync('sqlite3',[join(work,'state/userdata/statev2.sqlite'),sql],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(JSON.parse);
  }
  const call=(tool,args)=>({tool,args});
  async function decide(input) {
    const text=JSON.stringify(input.messages);
    if(text.includes('PERMISSION_STOP_CONTROL')) {
      if(!input.messages.some(m=>m.role==='tool'))return call('mcp__t3-code__t3_thread_interrupt',{threadId:rootId,stop:true,reason:'Cancel unapproved fixture',clientRequestId:`permission-stop-${rootId}`});
      return {text:'PERMISSION_STOP_REQUESTED'};
    }
    if(text.includes('PERMISSION_LEAF_PROFILE')){
      childRequests++;assert.equal(childRequests,1,'approval denial must not continue child inference');
      return call('fixture_approval_write',{});
    }
    if(!launched){launched=true;return call('subagent',{agent:'proof-permission',name:'proof-permission',task:'Attempt the private fixture write; never bypass approval.'});}
    if(!attempted){
      const end=Date.now()+15000;
      while(Date.now()<end){
        if(rootId){const member=child();if(member){const rows=events().filter(e=>e.threadId===member.id);const item=rows.find(e=>e.data.type==='approval_request');if(item){const request=rows.filter(e=>e.eventType==='runtime-request.updated'&&e.data.id===item.data.requestId).at(-1);if(request?.data.status==='pending'&&request.data.kind==='command'){approval={requestId:item.data.requestId,childThreadId:member.id,requestKind:item.data.requestKind,itemType:item.data.type,kind:request.data.kind,status:request.data.status};break;}}}}
        await delay(50);
      }
      assert(approval,'actual owned native permission request registered');attempted=true;
      writeFileSync(join(work,'native-permission.json'),JSON.stringify(approval,null,2));
      return call('subagent_message',{name:'proof-permission',requestId:approval.requestId,message:'MUST_NOT_APPROVE'});
    }
    const last=input.messages.filter(m=>m.role==='tool').at(-1);
    assert(/permission requests cannot be answered|not a pending user question/i.test(JSON.stringify(last)),'request-kind refusal, not wrong-owner refusal');refused=true;
    return {text:reply};
  }
  function verify(){
    assert(refused);assert.equal(childRequests,1);assert(!existsSync(file),'approval-gated write never executed');
    const last=events().filter(e=>e.eventType==='runtime-request.updated'&&e.data.id===approval.requestId).at(-1);
    assert.equal(last.data.status,'pending','answer facade did not mutate approval');assert.equal(last.data.kind,'command');
    const member=child();assert.equal(member.id,approval.childThreadId);assert(member.live&&member.deliverable!==false,'refusal tested against live owned recipient');
    return {...approval,refused,childRequests,writeAbsent:true,approvalStillPending:true};
  }
  function afterStop(){
    assert.equal(childRequests,1,'cancelled permission wait did not resume inference');
    assert(!existsSync(file));
    const last=events().filter(e=>e.eventType==='runtime-request.updated'&&e.data.id===approval.requestId).at(-1);
    assert.equal(last.data.status,'cancelled','native STOP cancelled, never approved, the permission request');
    return {approvalTerminalStatus:last.data.status,childRequestsAfterStop:childRequests,writeAbsentAfterStop:true};
  }
  return {decide,verify,afterStop,setRoot:id=>{rootId=id;},child:()=>child()};
}

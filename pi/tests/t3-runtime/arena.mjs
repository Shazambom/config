// Scripted model phases use real native completion notifications and real tools.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function arenaFixture(work, mode) {
  const artifacts=join(work,'workspace/arena-artifacts');mkdirSync(artifacts,{recursive:true});
  const candidate=role=>join(artifacts,`${role}.txt`);
  const dropout=mode==='arena-dropout';
  const cancelling=mode==='arena-cancel';
  const held=new Set(), closed=new Set();
  let stopIssued=false, laterTargetRequests=0, controlCompleted=false;
  const survivors=dropout?['candidate-a']:['candidate-a','candidate-b'];
  const profiles=[['arena','read,write,bash','worker,reviewer','ARENA_COORDINATOR_PROFILE'],['worker','read,write','','ARENA_CANDIDATE_PROFILE'],['reviewer','read','','ARENA_REVIEWER_PROFILE']];
  mkdirSync(join(work,'agent/agents'),{recursive:true});
  for(const [name,tools,children,marker] of profiles)writeFileSync(join(work,'agent/agents',`${name}.md`),`---\nname: ${name}\ndescription: Actual native arena fixture\ntools: ${tools}\n${children?`subagent_agents: ${children}\n`:''}system-prompt: append\n---\n${marker}\n`);
  mkdirSync(join(work,'agent/skills/arena'),{recursive:true});
  writeFileSync(join(work,'agent/skills/arena/SKILL.md'),'---\nname: arena\ndescription: Native arena phase fixture\n---\nFrame. Fan out fresh independent candidate artifacts and rationales. Read every output. After all candidates finish, cross-judge with one read-only reviewer while reading candidates yourself. Pick a base, graft a useful idea, record rejections and dropouts, and verify the actual synthesized artifact.\n');
  if(process.env.CONFIG_PI_RUNTIME_DIR) {
    const source=join(process.env.CONFIG_PI_RUNTIME_DIR,'../repo/pi/agent/agents');
    mkdirSync(source,{recursive:true});
    for(const [name] of profiles)writeFileSync(join(source,`${name}.md`),readFileSync(join(work,'agent/agents',`${name}.md`)));
  }
  const stages=new Set(), consumed=new Set(), nativeCompleted=new Map();
  let rootCompletionObserved=false;
  let rootId, launched=false, judged=false, synthesized=false, verified=false, suspensionObserved=false, savedDesired;
  const dir=()=>join(work,'home/.pi/t3-teams/teams',createHash('sha256').update(rootId).digest('hex'));
  const state=()=>rootId&&existsSync(join(dir(),'state.json'))?JSON.parse(readFileSync(join(dir(),'state.json'),'utf8')):undefined;
  function observe(){const s=state();if(s?.leases.length){suspensionObserved=true;savedDesired=s.desired;}return s;}
  function record(result,displayName) {
    const member=Object.values(state()?.members??{}).find(m=>m.t3?.taskId===result.taskId);
    assert(member,'completion belongs to an actual bound member');
    const childThreadId=result.childThreadId??member.id;
    const childRunId=result.childRunId??member.t3.runId;
    assert.equal(childThreadId,member.id);assert.equal(childRunId,member.t3.runId);
    const key=JSON.stringify([result.taskId,childThreadId,childRunId]);
    const prior=nativeCompleted.get(key);
    if(prior)assert.equal(prior.status,result.status,'same bound run has consistent terminal status');
    nativeCompleted.set(key,{id:result.taskId,childThreadId,childRunId,status:result.status,role:member.name.split('/').at(-1),displayName});
  }
  const completedRole=role=>[...nativeCompleted.values()].some(t=>t.role===role);
  function decide(input) {
    const transcript=JSON.stringify(input.messages);
    if(transcript.includes('CONTROL_UNRELATED'))return {text:'UNRELATED_ALIVE'};
    if(transcript.includes('CONTROL_STOP_NATIVE_ARENA')) {
      const response=input.messages.filter(m=>m.role==='tool').at(-1);
      if(!response) {
        assert(held.size===2,'control acts only after both candidate provider barriers');
        stopIssued=true;
        return {calls:[{tool:'mcp__t3-code__t3_thread_interrupt',args:{threadId:rootId,stop:true,reason:'Fixture cancellation',clientRequestId:`fixture-stop-${rootId}`}}]};
      }
      assert(!/error|denied|forbidden/i.test(JSON.stringify(response)),'native stop tool did not fail');
      controlCompleted=true;
      return {text:'CONTROL_STOP_REQUESTED'};
    }
    if(cancelling&&stopIssued){laterTargetRequests++;throw new Error('Cancelled target attempted later inference');}
    const role=transcript.includes('ARENA_COORDINATOR_PROFILE')?'arena':transcript.includes('ARENA_REVIEWER_PROFILE')?'judge':transcript.includes('CANDIDATE a')?'candidate-a':transcript.includes('CANDIDATE b')?'candidate-b':'root';
    if(role==='root') {
      assert(verified&&transcript.includes('Delegated task ')&&transcript.includes('[completed]')&&transcript.includes('ARENA_FINAL_SYNTHESIS_VERIFIED'),'root inference allowed only after real arena completion, never to launch arena');
      rootCompletionObserved=true;
      return {text:'ARENA_ROOT_COMPLETED'};
    }
    assert(!input.tools.some(t=>t.function.name==='team_send'),'arena suspends normal messaging');
    observe();
    const corrections=new Set();
    for(const m of input.messages) {
      const content=typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.map(p=>p.text??'').join('\n'):'';
      if(m.role==='tool') {
        try {
          const result=JSON.parse(content);
          const member=Object.values(state()?.members??{}).find(member=>member.t3?.taskId===result.taskId);
          if(member&&['completed','failed','interrupted','cancelled'].includes(result.status))record(result,member.name);
        } catch {}
      }
      for(const match of content.matchAll(/Completed owned tasks still need model-visible result consumption: (.*?)\. Call mcp__t3-code__task_status/g))for(const id of match[1].split(', '))corrections.add(id);
    }
    const calls=[];let text='Waiting for owned work.';
    const push=(tool,args)=>calls.push({tool,args});
    for(const m of input.messages.filter(m=>m.role==='user')) {
      const content=typeof m.content==='string'?m.content:m.content.map(p=>p.text??'').join('\n');
      for(const match of content.matchAll(/Delegated task (\S+) \(([^)]+)\) \[(completed|failed|interrupted|cancelled)\]:/g))record({taskId:match[1],status:match[3]},match[2]);
    }
    if(role==='arena') {
      if(!launched){launched=true;for(const suffix of ['a','b'])push('subagent',{agent:'worker',name:`candidate-${suffix}`,task:`CANDIDATE ${suffix}: independently write the artifact and rationale, including rejected alternatives, to ${candidate(`candidate-${suffix}`)}`});}
      else {
        const unread=[...new Set([...nativeCompleted.values()].map(t=>t.id).concat([...corrections]))].filter(id=>!consumed.has(id)).map(id=>({id}));
        if(unread.length){for(const t of unread){push('mcp__t3-code__task_status',{taskId:t.id});consumed.add(t.id);}}
        else if(!judged&&completedRole('candidate-a')&&completedRole('candidate-b')){
          judged=true;
          for(const r of survivors)push('read',{path:candidate(r)});
          push('subagent',{agent:'reviewer',name:'judge',task:`CROSS_JUDGE: read ${survivors.map(candidate).join(' and ')} end to end; score correctness and simplicity, then recommend a base with rationale.${dropout?' Candidate-b dropped out; do not invent its output.':''}`});
        }else if(completedRole('judge')&&!synthesized){
          synthesized=true;
          push('write',{path:join(artifacts,'synthesized.txt'),content:dropout?'Base candidate a; preserve verification after candidate-b dropout.\n':'Base candidate a; graft useful verification from candidate b.\n'});
          push('write',{path:join(artifacts,'synthesis.md'),content:dropout?'Base: candidate a. Judge agrees. Graft: none with one survivor. Rejected: claiming missing output. Dropouts: candidate-b provider failure. Same fixture model family. Verification: concrete artifact check.\n':'Base: candidate a, simpler boundary. Judge agrees. Graft: verification from b. Rejected: b complexity. Dropouts: none. Same fixture model family. Verification: concrete artifact check.\n'});
        }else if(synthesized&&!verified){verified=true;push('bash',{command:`test -s ${JSON.stringify(join(artifacts,'synthesized.txt'))} && grep -q verification ${JSON.stringify(join(artifacts,'synthesized.txt'))}`});}
        else if(verified)text='ARENA_FINAL_SYNTHESIS_VERIFIED';
      }
    }else if(role==='judge'){
      assert(completedRole('candidate-a')&&completedRole('candidate-b'),'judge starts after native candidate completions');
      if(!stages.has(role)){stages.add(role);for(const r of survivors)push('read',{path:candidate(r)});}else text=dropout?'JUDGE_VERDICT: candidate a survives; candidate-b failed.':'JUDGE_VERDICT: candidate a is the simpler base; graft b verification.';
    }else{
      if(cancelling){held.add(role);return {hold:role};}
      if(dropout&&role==='candidate-b')return {providerError:'fixture candidate dropout'};
      if(!stages.has(role)){stages.add(role);push('write',{path:candidate(role),content:`Artifact ${role}. Rationale: choose a narrow boundary; reject a broad framework. Verification idea included.\n`});}else text=`CANDIDATE_FINAL ${role}`;
    }
    return calls.length?{calls}:{text};
  }
  function cancellationReady(){const s=observe();return held.size===2&&s?.leases.length===1;}
  function done(){const s=observe();if(cancelling)return controlCompleted&&closed.size===2&&s?.leases.length===0&&Object.values(s.members).filter(m=>m.parent!==null).every(m=>m.live===false&&m.deliverable===false);return verified&&s?.leases.length===0&&Object.values(s.members).some(m=>m.name.startsWith('arena-')&&m.t3?.status==='completed');}
  function verify(alive){
    const s=state();
    if(cancelling){
      assert(done(),'native stop closed held requests, restored suspension and fenced children');
      assert.equal(s.desired,savedDesired);
      assert.equal(laterTargetRequests,0);
      const members=Object.values(s.members).filter(m=>m.parent!==null);
      assert.equal(members.length,3,'only coordinator and two held candidates');
      assert(!existsSync(join(artifacts,'synthesized.txt')),'cancelled work produced no synthesis');
      return {nativeStop:true,held:[...held],closed:[...closed],suspensionObserved,savedDesired,restoredDesired:s.desired,laterTargetRequests,children:members.map(m=>({threadId:m.id,pid:m.pid,live:m.live,deliverable:m.deliverable,localObservedStatus:m.t3?.status,processAlive:alive(m.pid)}))};
    }
    assert(rootCompletionObserved,'native completion reached actual root model');assert(done(),'native arena coordinator completed and suspension restored');
    assert(suspensionObserved,'suspension observed during actual model requests');
    assert.equal(s.desired,savedDesired,'saved choice restored');
    if(mode==='arena-off')assert.equal(s.desired,false);
    assert.equal(nativeCompleted.size,3,'two candidates and cross-judge had native completion');
    for(const t of nativeCompleted.values()){assert.equal(t.status,dropout&&t.role==='candidate-b'?'failed':'completed');assert(consumed.has(t.id));}
    for(const r of survivors)assert(readFileSync(candidate(r),'utf8').includes('Rationale:'));
    assert.equal(existsSync(candidate('candidate-b')),!dropout);
    assert(readFileSync(join(artifacts,'synthesized.txt'),'utf8').includes('verification'));
    if(dropout)assert(readFileSync(join(artifacts,'synthesis.md'),'utf8').includes('Dropouts: candidate-b provider failure'));
    const entries=[];
    const collect=path=>{for(const e of readdirSync(path,{withFileTypes:true})){const file=join(path,e.name);if(e.isDirectory())collect(file);else if(e.name.endsWith('.jsonl'))entries.push(...readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));}};
    collect(join(work,'agent/sessions'));
    assert(entries.some(e=>e.customType==='arena-outcome'&&e.data.status==='finished'),'actual command outcome persisted');
    const results=entries.filter(e=>e.message?.role==='toolResult').map(e=>e.message);
    assert(results.some(m=>m.toolName==='bash'&&m.isError===false),'actual artifact verification tool succeeded');
    assert(!results.some(m=>m.isError),'arena tools must succeed, not just be requested');
    assert.equal(results.filter(m=>m.toolName==='mcp__t3-code__task_status').length,3,'all three child results consumed by coordinator tools');
    const members=Object.values(s.members).filter(m=>m.parent!==null);
    assert.equal(members.length,4,'coordinator, two candidates, one judge');
    assert(members.every(m=>alive(m.pid)),'native host retains idle child processes');
    return {artifacts,rootCompletionObserved,nativeCompletions:[...nativeCompleted.values()],suspensionObserved,savedDesired,restoredDesired:s.desired,retainedPids:members.map(m=>m.pid)};
  }
  return {decide,done,verify,cancellationReady,closed:role=>closed.add(role),members:()=>Object.values(state()?.members??{}).filter(m=>m.parent!==null),setRoot:id=>{rootId=id;}};
}

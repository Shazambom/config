// Node is needed for concurrent JSONL/SSE, UI responses, and cancellation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const [cli, work, guard, only] = process.argv.slice(2);
const requests = [], clients = new Set();
let highUsageSent = false;
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body); requests.push(request);
  appendFileSync(join(work, 'provider.jsonl'), JSON.stringify({time:Date.now(),request})+'\n');
  res.writeHead(200, {'Content-Type':'text/event-stream'});
  const base = {id:`test-${requests.length}`,object:'chat.completion.chunk',created:1,model:request.model};
  const highUsage = !highUsageSent && JSON.stringify(request.messages).includes('AUTOCOMPACT_SEED');
  if(highUsage) highUsageSent=true;
  for (const [delta,finish_reason] of [[{role:'assistant',content:'DELIVERED'},null],[{},'stop']]) res.write(`data: ${JSON.stringify({...base,choices:[{index:0,delta,finish_reason}],...(finish_reason ? {usage:{prompt_tokens:highUsage?99500:10,completion_tokens:1,total_tokens:highUsage?99501:11}} : {})})}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'models.json'), JSON.stringify({providers:{fixture:{api:'openai-completions',apiKey:'synthetic',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'base',input:['text','image'],contextWindow:100000,maxTokens:1000},{id:'selected',reasoning:true,input:['text','image'],contextWindow:100000,maxTokens:1000}]}}}));
writeFileSync(join(process.env.PI_CODING_AGENT_DIR,'settings.json'), JSON.stringify({defaultProvider:'fixture',defaultModel:'base',retry:{enabled:false},compaction:{enabled:false,reserveTokens:1000,keepRecentTokens:1000},imageAutoResize:false}));
const admission = join(work,'admission.ts');
writeFileSync(admission, `import {appendFileSync} from 'node:fs';
export default function(pi) {
  let gateActive=false;
  pi.on('rpc_ready', async (event,ctx)=>{
    if (!['prompt','steer','follow_up','compact','bash'].includes(event.command) || event.phase!=='before_dispatch' || gateActive) return;
    gateActive=true;
    event.signal.addEventListener('abort',()=>appendFileSync(${JSON.stringify(join(work,'aborts.jsonl'))},JSON.stringify({pid:process.pid,command:event.command})+'\\n'),{once:true});
    const accepted=await ctx.ui.confirm('ADMISSION','Allow this exact request?',{signal:event.signal});
    if (!accepted) throw new Error('ADMISSION_REFUSED');
  });
  pi.registerCommand('fixture-reload',{handler:async(_,ctx)=>{await ctx.reload();}});
  pi.registerCommand('fixture-error',{handler:()=>{throw new Error('COMMAND_SIDE_EFFECT_MUST_NOT_RETRY');}});
}`);
const settlement = join(work,'settlement.ts');
writeFileSync(settlement, `import {appendFileSync} from 'node:fs';
export default function(pi) { let held=false; pi.on('agent_before_settle',async(event,ctx)=>{
  if(held)return;held=true;
  ctx.ui.notify('BOUNDARY_HOLD','info');
  await new Promise(resolve=>{
    const cancelled=()=>{appendFileSync(${JSON.stringify(join(work,'settlement-aborts.jsonl'))},JSON.stringify({pid:process.pid,aborted:event.signal.aborted})+'\\n');resolve();};
    if(event.signal?.aborted)cancelled();else event.signal?.addEventListener('abort',cancelled,{once:true});
  });
  return {continue:true};
}); pi.registerCommand('fixture-success',{handler:(_,ctx)=>ctx.ui.notify('COMMAND_SUCCESS','info')}); }`);
const hookAbort = join(work,'hook-abort.ts');
writeFileSync(hookAbort, `export default function(pi){let first=true,followed=false;
  pi.on('agent_before_settle',(_event,ctx)=>{if(first){first=false;ctx.ui.notify('NATIVE_BOUNDARY_ABORT','warning');ctx.abort();return {continue:true};}});
  pi.on('agent_settled',event=>{if(event.aborted&&!followed){followed=true;pi.sendUserMessage('DEFERRED_SUCCESS_AFTER_ABORT');}});
}`);
const commandTools = join(work,'command-tools.ts');
writeFileSync(commandTools, `import {appendFileSync} from 'node:fs';
export default function(pi) {
  const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
  const saved=Symbol.for('fixture.command.context');
  const audit=value=>appendFileSync(${JSON.stringify(join(work,'command-tools.jsonl'))},JSON.stringify(value)+'\\n');
  const report=(ctx,result)=>ctx.ui.notify('COMMAND_TOOL_RESULT '+JSON.stringify(result),'info');
  pi.registerTool({name:'fixture_echo',label:'Fixture echo',description:'Test only',parameters:schema,
    async execute(id,args){audit({id,text:args.text});return {content:[{type:'text',text:args.text}],details:{executed:true}};}});
  pi.registerTool({name:'fixture_outer',label:'Fixture outer',description:'Nested test',parameters:schema,
    async execute(_id,args,_signal,_update,ctx){return (await ctx.executeTool('fixture_echo',args)).result;}});
  pi.registerTool({name:'fixture_hold',label:'Fixture hold',description:'Cancellation test',parameters:{type:'object',properties:{}},
    async execute(id,_args,signal,_update,ctx){ctx.ui.notify('COMMAND_TOOL_HOLD','info');await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});audit({id,cancelled:signal.aborted});return {content:[{type:'text',text:'CANCELLED'}],details:{},isError:true};}});
  pi.on('tool_call',event=>event.toolName==='fixture_echo'&&event.input.text==='DENY'?{block:true,reason:'FIXTURE_PERMISSION_DENIED'}:undefined);
  pi.on('tool_result',event=>event.toolName==='fixture_echo'?{content:[{type:'text',text:'HOOKED_'+event.content[0].text}]}:undefined);
  pi.registerCommand('fixture-command-tool',{handler:async(args,ctx)=>report(ctx,await ctx.executeTool('fixture_echo',JSON.parse(args)))});
  pi.registerCommand('fixture-nested',{handler:async(_,ctx)=>report(ctx,await ctx.executeTool('fixture_outer',{text:'NESTED'}))});
  pi.registerCommand('fixture-save-context',{handler:(_,ctx)=>{globalThis[saved]=ctx;}});
  pi.registerCommand('fixture-use-context',{handler:async(_,ctx)=>{try{report(ctx,await globalThis[saved].executeTool('fixture_echo',{text:'LATE'}));}catch(error){report(ctx,{isError:true,error:String(error)});}}});
  pi.registerCommand('fixture-reload-context',{handler:async(_,ctx)=>{globalThis[saved]=ctx;await ctx.reload();}});
  pi.registerCommand('fixture-hold-tool',{handler:async(_,ctx)=>report(ctx,await ctx.executeTool('fixture_hold',{}, {signal:new AbortController().signal}))});
  pi.registerCommand('fixture-concurrent',{handler:async(_,ctx)=>{
    await ctx.executeTool('fixture_echo',{text:'FIRST_COUNTER'});
    await ctx.ui.confirm('CONTINUE_COMMAND','Continue?');
    report(ctx,await ctx.executeTool('fixture_echo',{text:'SECOND_COUNTER'}));
  }});
  pi.registerCommand('fixture-return-early',{handler:(_,ctx)=>{void ctx.executeTool('fixture_echo',{text:'UNAWAITED'}).then(result=>audit({unawaited:result.isError}));}});
}`);
function start(name, extensions = [], session) {
  const cwd=join(work,name); mkdirSync(cwd,{recursive:true});
  const args=['--mode','rpc','--no-extensions','--no-skills','--no-prompt-templates','--session',session??join(cwd,'session.jsonl')];
  for(const extension of extensions) args.push('-e',extension);
  const child=spawn(cli,args,{cwd,env:process.env,stdio:['pipe','pipe','pipe']}); clients.add(child);
  const records=[], waiting=new Set(); let buffer='',sequence=0;
  const notify=()=>{for(const callback of waiting) callback();};
  child.stdout.on('data',chunk=>{
    appendFileSync(join(cwd,'stdout.jsonl'),chunk); buffer+=chunk;
    for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.trim())records.push(JSON.parse(line));}
    notify();
  });
  child.stderr.on('data',chunk=>appendFileSync(join(cwd,'stderr.txt'),chunk)); child.on('exit',notify);
  function wait(predicate,label='response',timeout=15000){return new Promise((resolve,reject)=>{
    const finish=(error,result)=>{clearTimeout(timer);waiting.delete(check);error?reject(error):resolve(result);};
    const check=()=>{const result=records.find(predicate);if(result)finish(undefined,result);else if(child.exitCode!==null||child.signalCode!==null)finish(new Error(`${name} exited waiting for ${label}`));};
    const timer=setTimeout(()=>finish(new Error(`${name} timeout: ${label}`)),timeout);waiting.add(check);check();
  });}
  function send(type,fields={},id=String(++sequence)){
    if(id===false)id=undefined;
    const record={id,type,...fields};appendFileSync(join(cwd,'input.jsonl'),JSON.stringify({time:Date.now(),...record})+'\n');child.stdin.write(JSON.stringify(record)+'\n');
    return wait(r=>r.type==='response'&&r.id===id,`${type} ${id}`);
  }
  async function ok(type,fields={},id){const result=await send(type,fields,id);assert.equal(result.success,true,JSON.stringify(result));return result.data;}
  async function turn(text,fields={}){const boundary=records.length;const data=await ok('prompt',{message:text,...fields});await wait((r,i)=>i>=boundary&&r.type==='agent_settled','settlement');return data;}
  async function gate(){const observed=await wait(r=>r.type==='extension_ui_request'&&r.title==='ADMISSION'||r.type==='agent_settled'||r.type==='response'&&r.success===false,'admission or unguarded execution');assert.equal(observed.type,'extension_ui_request','readiness must hold before provider/compaction');return observed;}
  function answer(request,confirmed){child.stdin.write(JSON.stringify({type:'extension_ui_response',id:request.id,confirmed})+'\n');}
  async function stop(){if(child.exitCode!==null||child.signalCode!==null){clients.delete(child);return;}const exited=once(child,'exit');child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{const [code]=await exited;assert.equal(code,0,'EOF must remain responsive');}finally{clearTimeout(timer);clients.delete(child);}}
  return {child,records,wait,send,ok,turn,gate,answer,stop};
}
async function childCases(){
  const held=start('held',[admission]);const before=requests.length;
  const text='COMPLETE task\nUnicode ☃\nwith trailing spaces  ';
  const image={type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
  const pending=held.send('prompt',{message:text,images:[image]},'original-id');
  const ui=await held.gate();assert.equal(requests.length,before,'zero pre-admission provider requests');
  await held.ok('get_state'); await held.ok('get_available_models'); await held.ok('get_entries');
  assert.equal(requests.length,before,'discovery does not release child admission');
  held.answer(ui,true);
  const response=await pending;assert.equal(response.id,'original-id');assert.equal(response.success,true);assert.equal(response.data.disposition,'started');
  await held.wait(r=>r.type==='agent_settled');assert.equal(requests.length,before+1);
  const content=requests.at(-1).messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);
  assert(content.some(p=>p.type==='text'&&p.text===text),'exact original text');
  assert(content.some(p=>p.type==='image_url'&&p.image_url.url===`data:image/png;base64,${image.data}`),'exact original image');
  await held.stop();
  for(const action of ['deny','abort','eof','timeout']){
    const client=start(action,[guard,admission]);const count=requests.length;
    const result=client.send('prompt',{message:`NEVER_${action}`});
    // EOF intentionally closes transport; consume that expected pending rejection.
    if(action==='eof') result.catch(()=>{});
    const ui=await client.gate();
    if(action==='deny')client.answer(ui,false);
    if(action==='abort')await client.ok('abort');
    if(action==='eof'){await client.stop();assert.equal(requests.length,count);continue;}
    const response=await result;assert.equal(response.success,false,`${action} must honestly reject original request`);
    assert.match(response.error,action==='deny'?/ADMISSION_REFUSED/:action==='abort'?/abort|cancel/i:/timeout|deadline/i);
    client.answer(ui,true);const state=await client.ok('get_state');assert.equal(requests.length,count,'late admission never dispatches rejected input');
    const {inspectOwner}=await import(pathToFileURL(join(dirname(guard),'lease.mjs')));
    const {ownerRequest}=await import(pathToFileURL(join(dirname(guard),'owner-client.mjs')));
    const evidence=inspectOwner(state.sessionFile);
    await ownerRequest(evidence.owner,evidence.sessionFile,'probe',1000);
    assert.equal(evidence.owner.status,'active','readiness expiry/refusal must retain ownership');
    await client.stop();
  }
  // Explicit compaction is held at the same boundary, before any summarization request.
  const compact=start('compact',[admission]);const count=requests.length;
  const operation=compact.send('compact');const compactUi=await compact.gate();
  assert.equal(requests.length,count,'zero pre-admission compaction requests');compact.answer(compactUi,false);
  assert.equal((await operation).success,false);await compact.stop();
  const seed=start('auto-compact-seed',[guard]);
  await seed.turn('OLD_CONTEXT '.repeat(1500));await seed.turn('AUTOCOMPACT_SEED '.repeat(1500));
  const saved=(await seed.ok('get_state')).sessionFile;await seed.stop();
  const auto=start('auto-compact',[guard,admission],saved);await auto.ok('set_auto_compaction',{enabled:true});
  const beforeAuto=requests.length;const pendingAuto=auto.send('prompt',{message:'AFTER_AUTOCOMPACT'});
  const autoUi=await auto.gate();assert.equal(requests.length,beforeAuto,'no automatic compaction before child admission');
  assert(!auto.records.some(r=>r.type==='auto_compaction_start'),'no pre-admission compaction event');
  auto.answer(autoUi,true);assert.equal((await pendingAuto).success,true);
  await auto.wait(r=>r.type==='agent_settled');
  assert(auto.records.some(r=>r.type==='compaction_start'||r.type==='auto_compaction_start'),'admitted request actually exercises automatic compaction');
  assert(JSON.stringify(requests.at(-1).messages).includes('AFTER_AUTOCOMPACT'));
  await auto.stop();
  const first=start('first-resume-gate',[guard,admission],saved);
  const firstPending=first.send('prompt',{message:'FIRST_RESUMED_CHILD_TASK'});const firstUi=await first.gate();
  first.answer(firstUi,true);assert.equal((await firstPending).success,true);await first.wait(r=>r.type==='agent_settled');await first.stop();
  console.log('PASS readiness: discovery/UI, text/images once, honest refusal/abort/expiry/EOF with retained ownership, explicit and automatic compaction gates');
}
async function replacements(){
  const seed=start('replacement-seed');await seed.turn('SAVED_TARGET');const saved=(await seed.ok('get_state')).sessionFile;const entries=(await seed.ok('get_entries')).entries;const user=entries.find(e=>e.type==='message'&&e.message.role==='user');await seed.stop();
  for(const transition of ['new_session','switch_session','same-switch','fork','clone','reload']){
    const client=start(`replace-${transition}`,[admission],['fork','clone','same-switch'].includes(transition)?saved:undefined);
    const count=requests.length;const pending=client.send('prompt',{message:'MUST_NOT_RETARGET'});const ui=await client.gate();
    if(transition==='reload')await client.ok('prompt',{message:'/fixture-reload'});
    else await client.ok(transition==='same-switch'?'switch_session':transition,['switch_session','same-switch'].includes(transition)?{sessionPath:saved}:transition==='fork'?{entryId:user.id}:{});
    const result=await pending;assert.equal(result.success,false,transition+' cancels held old-session work');
    client.answer(ui,true);await client.ok('get_state');assert.equal(requests.length,count,'no retargeting after '+transition);await client.stop();
  }
  console.log('PASS held requests cannot follow new/switch/fork/reload into another runtime');
}
async function ownership(){
  for(let iteration=0;iteration<3;iteration++){
    const seed=start(`owner-seed-${iteration}`,[guard]);await seed.turn('OWNED_HISTORY');const saved=(await seed.ok('get_state')).sessionFile;await seed.stop();
    const client=start(`owner-client-${iteration}`,[guard]);
    await client.ok('switch_session',{sessionPath:saved});await client.ok('get_state');await client.ok('get_available_models');await client.ok('get_entries');
    await client.ok('set_model',{provider:'fixture',modelId:'selected'});await client.ok('set_thinking_level',{level:'high'});await client.ok('set_session_name',{name:'kept-name'});
    const boundary=client.records.length;
    // T3 uses an id-less prompt and send-order acknowledgements.
    const response=await client.send('prompt',{message:`RPC_TASK_${iteration}`,streamingBehavior:'steer'},false);
    assert.equal(response.success,true);await client.wait((r,i)=>i>=boundary&&r.type==='agent_settled');
    assert.equal(requests.at(-1).model,'selected','acknowledged model selection must reach provider');
    assert(JSON.stringify(requests.at(-1).messages).includes('OWNED_HISTORY'));
    const state=await client.ok('get_state');assert.equal(state.thinkingLevel,'high');assert.equal(state.sessionName,'kept-name');
    await client.stop();
  }
  const owner=start('conflict-owner',[guard]);await owner.turn('LIVE_OWNER');const saved=(await owner.ok('get_state')).sessionFile;
  const count=requests.length;const contender=start('conflict-contender',[guard],saved);
  const pending=contender.send('prompt',{message:'MUST_NOT_ENTER_CONFLICT'});
  const dialog=await contender.wait(r=>r.type==='extension_ui_request'&&r.method==='select','startup ownership dialog');
  assert.equal(requests.length,count,'no provider work while initial binding awaits ownership dialog');
  const exited=once(contender.child,'exit');
  contender.child.stdin.write(JSON.stringify({type:'extension_ui_response',id:dialog.id,cancelled:true})+'\n');
  assert.equal((await pending).success,false,'cancelled ownership rejects original request');
  let timer;
  try {const [code]=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cancelled startup did not shut down')),3000);})]);assert.equal(code,0);} finally {clearTimeout(timer);}
  await contender.stop();await owner.stop();assert.equal(requests.length,count);
  console.log('PASS real ownership freshness, T3-shaped metadata/input, and responsive startup conflict cancellation');
}
async function aliasCases(){
  const seed=start('alias-seed',[guard]);await seed.turn('ALIAS_OWNED_HISTORY');const saved=(await seed.ok('get_state')).sessionFile;await seed.stop();
  const alias=join(work,'saved-session-alias.jsonl');symlinkSync(saved,alias);
  for(const kind of ['cli','switch']){
    const client=start(`alias-${kind}`,[guard],kind==='cli'?alias:undefined);
    if(kind==='switch')await client.ok('switch_session',{sessionPath:alias});
    const count=requests.length;await client.turn(`ALIAS_FIRST_INPUT_${kind}`);
    assert.equal(requests.length,count+1,'same-file alias freshness preserves original input exactly once');
    assert(JSON.stringify(requests.at(-1).messages).includes('ALIAS_OWNED_HISTORY'));
    assert(!client.records.some(r=>r.type==='extension_error'),'alias freshness has no stale-context errors');
    const state=await client.ok('get_state');assert.equal(realpathSync(state.sessionFile),realpathSync(saved));
    appendFileSync(join(work,'alias-observations.jsonl'),JSON.stringify({kind,requested:alias,selected:state.sessionFile,canonical:realpathSync(state.sessionFile)})+'\n');
    await client.stop();
  }
  const held=start('alias-explicit-switch',[guard,admission],saved);const count=requests.length;
  const pending=held.send('prompt',{message:'MUST_NOT_RETARGET_ALIAS'});const ui=await held.gate();
  await held.ok('switch_session',{sessionPath:alias});assert.equal((await pending).success,false,'explicit alias switch still cancels held execution');
  held.answer(ui,true);await held.ok('get_state');assert.equal(requests.length,count);
  await held.stop();
  console.log('PASS saved-session symlink alias: CLI/RPC freshness preserves input and history; explicit client alias switch still fences held work');
}
async function commandToolCases(){

  const client=start('command-tool-fresh',[commandTools]);const count=requests.length;
  await client.ok('prompt',{message:'/fixture-command-tool {"text":"FIRST_WITHOUT_ASSISTANT"}'});
  const observed=await client.wait(r=>r.type==='extension_error'||r.type==='extension_ui_request'&&r.message?.startsWith('COMMAND_TOOL_RESULT'),'command-origin tool outcome');
  assert.equal(observed.type,'extension_ui_request','registered command must execute a validated tool without a prior assistant');
  const result=JSON.parse(observed.message.slice('COMMAND_TOOL_RESULT '.length));
  assert.equal(result.isError,false);assert.equal(result.result.content[0].text,'HOOKED_FIRST_WITHOUT_ASSISTANT');
  assert.equal(requests.length,count,'command tool execution requires no model request');
  const entries=(await client.ok('get_entries')).entries;
  assert(!entries.some(e=>e.type==='message'&&['assistant','toolResult'].includes(e.message.role)),'no fabricated assistant or transcript tool result');
  const outcome=async message=>{const boundary=client.records.length;await client.ok('prompt',{message});const event=await client.wait((r,i)=>i>=boundary&&r.type==='extension_ui_request'&&r.message?.startsWith('COMMAND_TOOL_RESULT'));return JSON.parse(event.message.slice('COMMAND_TOOL_RESULT '.length));};
  assert.equal((await outcome('/fixture-command-tool {"text":"DENY"}')).isError,true);
  assert.equal((await outcome('/fixture-command-tool {}')).isError,true);
  assert.equal((await outcome('/fixture-command-tool {"text":123}')).result.content[0].text,'HOOKED_123','native argument coercion stays intact');
  assert.equal((await outcome('/fixture-nested')).result.content[0].text,'HOOKED_NESTED');
  const nested=client.records.filter(r=>r.type==='tool_execution_start'&&r.args?.text==='NESTED');
  assert.equal(nested.length,2);assert.match(nested[0].parentToolCallId,/^command:[a-f0-9-]+$/);assert.equal(nested[1].parentToolCallId,nested[0].toolCallId);
  await client.ok('prompt',{message:'/fixture-save-context'});
  assert.equal((await outcome('/fixture-use-context')).isError,true,'completed command context refuses later calls');
  await client.ok('prompt',{message:'/fixture-reload-context'});
  assert.equal((await outcome('/fixture-use-context')).isError,true,'reloaded context refuses later calls');
  const held=client.send('prompt',{message:'/fixture-hold-tool'});
  await client.wait(r=>r.type==='extension_ui_request'&&r.message==='COMMAND_TOOL_HOLD');
  await client.ok('abort');assert.equal((await held).success,true);
  const concurrentBoundary=client.records.length;
  const concurrent=client.send('prompt',{message:'/fixture-concurrent'});
  const dialog=await client.wait((r,i)=>i>=concurrentBoundary&&r.type==='extension_ui_request'&&r.title==='CONTINUE_COMMAND');
  await client.turn('MODEL_DURING_COMMAND');
  client.answer(dialog,true);assert.equal((await concurrent).success,true);
  const calls=client.records.slice(concurrentBoundary).filter(r=>r.type==='tool_execution_start'&&r.args?.text?.endsWith('_COUNTER'));
  assert.equal(calls.length,2);assert.equal(calls[0].parentToolCallId,calls[1].parentToolCallId);assert.equal(calls[0].toolCallId,calls[0].parentToolCallId+'/1');assert.equal(calls[1].toolCallId,calls[1].parentToolCallId+'/2','model completion must preserve active command scope counter');
  await client.ok('prompt',{message:'/fixture-return-early'});
  const audits=readFileSync(join(work,'command-tools.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert(!audits.some(r=>['DENY','LATE','UNAWAITED'].includes(r.text)),'blocked, closed, and unawaited scopes have no tool effects');
  assert(audits.some(r=>r.cancelled),'command signal cannot be overridden by caller signal');
  assert.equal(requests.length,count+1,'only the explicit concurrent model turn reached provider');
  await client.stop();
  for(const action of ['new_session','eof']){
    const running=start(`command-tool-${action}`,[commandTools]);
    const pending=running.send('prompt',{message:'/fixture-hold-tool'});if(action==='eof')pending.catch(()=>{});
    await running.wait(r=>r.type==='extension_ui_request'&&r.message==='COMMAND_TOOL_HOLD');
    if(action==='new_session'){await running.ok('new_session');assert.equal((await pending).success,true);}
    await running.stop();
  }
  console.log('PASS fresh command tools: validation/permissions/result hooks, nested IDs, abort, closed/reloaded scopes, concurrent native completion, no fabricated model history');
}
async function settlementCases(){

  for(const action of ['abort','new_session','eof']){
    const client=start(`settle-${action}`,[settlement]);const count=requests.length;
    await client.ok('prompt',{message:`SETTLE_${action}`});
    await client.wait(r=>r.type==='extension_ui_request'&&r.message==='BOUNDARY_HOLD','live settlement hook');
    assert.equal(requests.length,count+1);
    if(action==='eof')await client.stop();
    else {
      await client.ok(action);const event=await client.wait(r=>r.type==='agent_settled');
      assert.equal(event.aborted,true,'settlement must truthfully mark the aborted native run');
      assert.equal(requests.length,count+1,'abort suppresses requested boundary continuation');
      if(action==='abort'){
        const settledCount=client.records.filter(r=>r.type==='agent_settled').length;
        await client.ok('prompt',{message:'/fixture-success'});
        assert.equal(client.records.filter(r=>r.type==='agent_settled').length,settledCount,'successful command does not invent an aborted run');
        const boundary=client.records.length;await client.turn('SUCCESS_AFTER_ABORT');
        const next=client.records.slice(boundary).find(r=>r.type==='agent_settled');assert.equal(next.aborted,false,'abort metadata must not leak into the next run');
      }
      await client.stop();
    }
    assert.equal(requests.length,count+(action==='abort'?2:1),'only the explicit follow-up adds another provider turn');
    const receipts=readFileSync(join(work,'settlement-aborts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert(receipts.some(r=>r.pid===client.child.pid&&r.aborted),'boundary signal must abort on '+action);
  }
  const native=start('native-hook-abort',[hookAbort]);const count=requests.length;
  await native.ok('prompt',{message:'ABORT_FROM_AWAITED_BOUNDARY'});
  const first=await native.wait(r=>r.type==='agent_settled');assert.equal(first.aborted,true,'ctx.abort in boundary marks native settlement');
  await native.wait(r=>r.type==='agent_settled'&&r.aborted===false,'deferred successful run');
  assert.equal(requests.length,count+2,'one original and one explicitly deferred success');
  const outcomes=native.records.filter(r=>r.type==='agent_settled').map(r=>r.aborted);assert.deepEqual(outcomes,[true,false]);
  await native.stop();
  console.log('PASS settlement signal and truthful aborted metadata: external/boundary abort, replacement/EOF, commands, next and deferred successful runs');
}
try{
  if(!only||only==='alias')await aliasCases();
  if(!only||only==='command-tool')await commandToolCases();
  if(!only||only==='settlement')await settlementCases();
  if(!only||only==='child')await childCases();
  if(!only||only==='replacement')await replacements();
  if(!only||only==='ownership')await ownership();
}finally{
  for(const child of clients){if(child.exitCode!==null||child.signalCode!==null)continue;const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}

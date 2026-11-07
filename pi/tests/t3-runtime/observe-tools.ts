// Read-only event-shape probe. No MCP calls and no result mutation.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
export default function(pi: any) {
  const log=(type:string,data:any)=>appendFileSync(join(process.env.PI_CODING_AGENT_DIR!,'native-tool-events.jsonl'),JSON.stringify({time:Date.now(),pid:process.pid,type,...data})+'\n');
  const fields=['taskId','childThreadId','childRunId','status','isError'];
  function projections(value:any,depth=0):any[] {
    if(depth>5||!value||typeof value!=='object')return [];
    const found:any[]=[];
    const selected=Object.fromEntries(fields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
    if(Object.keys(selected).length)found.push(selected);
    for(const [key,item] of Object.entries(value)) {
      if(key==='text'&&typeof item==='string') {try{found.push(...projections(JSON.parse(item),depth+1));}catch{}}
      else if(typeof item==='object')found.push(...projections(item,depth+1));
    }
    return found;
  }
  for(const type of ['tool_call','tool_result'])pi.on(type,(event:any)=>{
    if(!['mcp__t3-code__task_status','subagent'].includes(event.toolName))return;
    log(type,{toolName:event.toolName,toolCallId:event.toolCallId,keys:Object.keys(event),inputKeys:Object.keys(event.input??{}),contentTypes:event.content?.map((p:any)=>p.type),detailsKeys:Object.keys(event.details??{}),resultKeys:Object.keys(event.result??{}),projections:projections(event)});
  });
  for(const type of ['session_start','agent_before_settle','agent_settled'])pi.on(type,(event:any)=>{log(type,{aborted:event.aborted});});
  pi.on('context',(event:any)=>{
    const corrections=event.messages.filter((m:any)=>m.customType==='t3-result-obligation').map((m:any)=>String(m.content).match(/consumption: (.*?)\. Call/)?.[1]);
    if(corrections.length)log('context_correction',{taskIds:corrections});
  });
}

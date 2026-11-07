// Private test tool. T3's real RPC confirm bridge creates the approval request.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default function(pi:any) {
  pi.registerTool({
    name:'fixture_approval_write',label:'Fixture approval write',description:'Requires explicit confirmation before writing a harmless private marker.',
    parameters:{type:'object',properties:{},additionalProperties:false},
    async execute(_id:string,_args:any,signal:AbortSignal,_update:any,ctx:any) {
      const approved=await ctx.ui.confirm('Approve private fixture write?','This test must never approve the write.',{signal});
      if(approved)writeFileSync(join(ctx.cwd,'PERMISSION_MUST_NOT_WRITE'),'forbidden');
      return {content:[{type:'text',text:approved?'UNEXPECTED_APPROVAL':'Confirmation declined'}],details:{approved}};
    }
  });
}

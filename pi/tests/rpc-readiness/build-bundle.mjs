// Maintenance tool: rebuild the exact bundle edit from a privately patched
// unbundled Pi 1.0.4. esbuild is Pi's own compiler, not a setup dependency.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const [original, candidate, output] = process.argv.slice(2);
const { transformSync } = createRequire(join(original,'package.json'))('esbuild');
const chunk='dist/bundle/chunks/chunk-H33F2TZD.js';
const code=readFileSync(join(original,chunk),'utf8');
const start=code.indexOf('async function runRpcMode(runtimeHost){');
const end=code.indexOf('import{createInterface as createInterface4}',start);
assert(start>=0&&end>start,'known Pi 1.0.4 RPC boundaries');
let rpc=readFileSync(join(candidate,'dist/modes/rpc/rpc-mode.js'),'utf8');
rpc=rpc.slice(rpc.indexOf('export async function runRpcMode(')).replace('export async function','async function').replaceAll('crypto.randomUUID()', 'crypto3.randomUUID()');
const newRpc=transformSync(rpc,{loader:'js',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,target:'node22'}).code.trim();
const runner=readFileSync(join(candidate,'dist/core/extensions/runner.js'),'utf8');
const method=runner.slice(runner.indexOf('    async emitRpcReady(event)'),runner.indexOf('    async emit(event)'));
const compiled=transformSync(`class Readiness {${method}}`,{loader:'js',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,target:'node22'}).code.trim();
const body=compiled.slice(compiled.indexOf('{')+1,compiled.lastIndexOf('}'));
const context='createContext(){let runner=this,getModel2=this.getModel,getScopedModels=this.getScopedModels;return{';
const edits=[{old:code.slice(start,end),new:newRpc},{old:'async emit(event){',new:body+'async emit(event){'},{old:context,new:context+'rpcReadiness:!0,'}];
const session=readFileSync(join(candidate,'dist/core/agent-session.js'),'utf8');
for(const [sourceStart,sourceEnd,bundleStart,bundleEnd] of [
  ['    async _emitAgentSettled()', '    _handleAgentEvent =', 'async _emitAgentSettled(){','_handleAgentEvent='],
  ['    async _runBeforeSettleBoundary()', '    async _runInputHandlers(', 'async _runBeforeSettleBoundary(){','async _runInputHandlers('],
  ['    async abort()', '    async waitForIdle()', 'async abort(){this._isAgentRunActive','async waitForIdle(){'],
  ['    async _executeNestedToolCall(', '    _exceedsCompactionThreshold(', 'async _executeNestedToolCall(', '_exceedsCompactionThreshold('],
  ['    async _tryExecuteExtensionCommand(', '    _expandSkillCommand(', 'async _tryExecuteExtensionCommand(', '_expandSkillCommand('],
]) {
  const method=session.slice(session.indexOf(sourceStart),session.indexOf(sourceEnd));
  const wrapped=transformSync(`class Boundary {${method}}`,{loader:'js',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,target:'node22'}).code.trim();
  const methodBody=wrapped.slice(wrapped.indexOf('{')+1,wrapped.lastIndexOf('}'));
  const begin=code.indexOf(bundleStart),end=code.indexOf(bundleEnd,begin);
  assert(begin>=0&&end>begin,'known settlement method boundaries');
  edits.push({old:code.slice(begin,end),new:methodBody});
}
edits.push({old:'async _runAgentPrompt(messages){this._agentRunAbortRequested=!1,',new:'async _runAgentPrompt(messages){this._agentRunAbortRequested=!1,this._lastActivityOutcome="completed",'});
edits.push({old:'_isBeforeSettle=!1;',new:'_beforeSettleAbortController=void 0;_isBeforeSettle=!1;'});
edits.push({old:'dispose(){try{this.abortRetry()',new:'dispose(){try{for(const scope of this._commandToolScopes.values())scope.controller.abort();this._commandToolScopes.clear();this._abortDuringBeforeSettle=!0,this._beforeSettleAbortController?.abort(),this.abortRetry()'});
edits.push({old:'_nestedToolCalls;',new:'_nestedToolCalls;_commandToolScopes=new Map;'});
edits.push({old:'this._nestedToolCalls.clear()',new:'this._nestedToolCalls.clear(id=>this._commandToolScopes.has(id.split("/")[0]))'});
edits.push({old:'async reload(options){let oldRunner=this._extensionRunner',new:'async reload(options){await this._abortCommandTools();let oldRunner=this._extensionRunner'});
edits.push({old:'clear(){this.scopes.clear()}',new:'clear(keep){for(const id of this.scopes.keys())if(!keep?.(id))this.scopes.delete(id)}'});
const commandContext=runner.slice(runner.indexOf('    createCommandContext('),runner.indexOf('    async emitBoundary('));
const wrappedContext=transformSync(`class Command {${commandContext}}`,{loader:'js',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,target:'node22'}).code.trim();
const contextBody=wrappedContext.slice(wrappedContext.indexOf('{')+1,wrappedContext.lastIndexOf('}'));
const oldContextStart=code.indexOf('createCommandContext(){'),oldContextEnd=code.indexOf('async emitBoundary(',oldContextStart);
assert(oldContextStart>=0&&oldContextEnd>oldContextStart);
edits.push({old:code.slice(oldContextStart,oldContextEnd),new:contextBody});
let result=code;
for(const edit of edits){assert.equal(result.split(edit.old).length,2,`exactly one bundle match: ${edit.old.slice(0,100)}`);result=result.replace(edit.old,edit.new);}
writeFileSync(join(candidate,chunk),result);
writeFileSync(output,JSON.stringify(edits,null,2)+'\n');

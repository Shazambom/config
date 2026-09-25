// JavaScript is required by Pi's extension API. Input is sent through tmux.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
export default function (pi) {
  const record = (type, data = {}) => appendFileSync(process.env.PI_PATH_PROOF, JSON.stringify({type, ...data}) + '\n');
  pi.registerProvider('path-proof', {
    baseUrl: 'http://invalid.invalid', apiKey: 'synthetic', api: 'path-proof',
    models: [{id:'echo', name:'Offline completion proof', reasoning:false, input:['text'], cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1024}],
    streamSimple(model, context) {
      record('model', {messages:context.messages});
      const stream = createAssistantMessageEventStream();
      const message = {role:'assistant',content:[{type:'text',text:'Receipt.'}],api:model.api,provider:model.provider,model:model.id,stopReason:'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      stream.push({type:'done',reason:'stop',message}); stream.end(); return stream;
    }
  });
  pi.registerCommand('path-proof-command', {handler: async () => record('command')});
  pi.registerCommand('path-proof-new', {handler: async (_args, ctx) => { await ctx.newSession(); }});
  let unsubscribe;
  pi.on('session_shutdown', () => unsubscribe?.());
  pi.on('input', event => record('input', {text:event.text,source:event.source}));
  pi.on('agent_end', () => record('end'));
  pi.on('session_start', (_event, ctx) => {
    let pending = 0;
    ctx.ui.addAutocompleteProvider(current => ({
      async getSuggestions(...args) {
        pending++;
        record('query', {lines:[...args[0]],line:args[1],col:args[2]});
        try {
          // Fault cases still use real file suggestions, but exercise a provider
          // that ignores cancellation or rejects after its asynchronous work.
          const fault = existsSync(process.env.PI_PATH_FAULT) ? readFileSync(process.env.PI_PATH_FAULT, 'utf8').trim() : '';
          const options = fault === 'ignore-abort' ? {...args[3],signal:new AbortController().signal} : args[3];
          const result = await current.getSuggestions(...args.slice(0,3), options);
          if (fault === 'reject') { record('query-error'); throw new Error('Synthetic completion failure'); }
          record('suggestions', {prefix:result?.prefix,items:result?.items,aborted:args[3].signal.aborted});
          return result;
        } finally { pending--; }
      },
      applyCompletion(...args) {
        const result = current.applyCompletion(...args);
        record('completion', {lines:args[0],line:args[1],col:args[2],item:args[3],prefix:args[4],result});
        return result;
      },
      shouldTriggerFileCompletion: (...args) => current.shouldTriggerFileCompletion?.(...args) ?? true,
    }));
    unsubscribe = ctx.ui.onTerminalInput(data => {
      record('key', {data,pending});
      if (data === '\x1b[17~') { record('draft', {text:ctx.ui.getEditorText(),custom:!!ctx.ui.getEditorComponent()}); return {consume:true}; }
      if (data === '\x1b[15~') {ctx.ui.setEditorText('replacement draft');return {consume:true};}
      const command = {'\x1b[18~':'/vimmode off','\x1b[19~':'/vimmode on','\x1b[21~':'/path-proof-new'}[data];
      if (command) {pi.sendUserMessage(command,{expandPromptTemplates:true});return {consume:true};}
    });
    record('start');
  });
}

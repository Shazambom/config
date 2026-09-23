// Pi's extension API requires JavaScript. All input comes through the real terminal.
import { appendFileSync } from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

export default function (pi) {
  const record = (type, data) => appendFileSync(process.env.PI_VIM_PROOF, JSON.stringify({ type, ...data }) + '\n');
  pi.registerProvider('vim-proof', {
    baseUrl: 'http://invalid.invalid', apiKey: 'synthetic', api: 'vim-proof',
    models: [{ id: 'echo', name: 'Offline Vim proof', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 1024 }],
    streamSimple(model, context, options) {
      record('model', { messages: context.messages });
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [{ type: 'text', text: 'Offline receipt.' }],
        api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      if (JSON.stringify(context.messages.at(-1)).includes('busy-proof')) {
        record('busy', {});
        stream.push({ type: 'start', partial: message });
        options.signal.addEventListener('abort', () => {
          record('aborted', {});
          message.stopReason = 'aborted';
          message.errorMessage = 'Synthetic cancellation';
          stream.push({ type: 'error', reason: 'aborted', error: message });
          stream.end();
        }, { once: true });
        return stream;
      }
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end();
      return stream;
    },
  });
  pi.on('input', (event) => record('input', { text: event.text, source: event.source }));
  let unsubscribe;
  pi.on('session_start', (event, ctx) => {
    record('start', { reason: event.reason });
    unsubscribe = ctx.ui.onTerminalInput((data) => {
      if (data === '\x1b[17~') {
        record('draft', { text: ctx.ui.getEditorText(), custom: !!ctx.ui.getEditorComponent() });
        return { consume: true };
      }
      const command = { '\x1b[18~': '/vimmode off', '\x1b[19~': '/vimmode on', '\x1b[20~': '/vim-proof-reload' }[data];
      if (command) {
        pi.sendUserMessage(command, { expandPromptTemplates: true });
        return { consume: true };
      }
    });
  });
  pi.on('session_shutdown', () => unsubscribe?.());
  pi.on('agent_end', () => record('end', {}));
  pi.registerCommand('vim-proof-reload', { handler: async (_args, ctx) => { await ctx.reload(); } });
}

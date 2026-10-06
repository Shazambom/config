// Exercises Pi's real provider/tool/UI lifecycle without model or network calls.
import { appendFileSync } from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export default function (pi) {
  const root = process.env.PI_RENDER_PROOF;
  const record = (event, details = {}) => appendFileSync(`${root}/events.jsonl`, JSON.stringify({ event, ...details }) + '\n');
  const originalWrite = process.stdout.write;
  process.stdout.write = function (chunk, ...args) {
    appendFileSync(`${root}/output.ansi`, chunk);
    return originalWrite.call(this, chunk, ...args);
  };
  const activeTools = new Set();
  pi.registerTool({
    name: 'render_work', label: 'Synthetic tool', description: 'Offline rendering fixture',
    parameters: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] },
    async execute(_id, args, _signal, update) {
      activeTools.add(args.index);
      record('tool-start', { index: args.index, active: activeTools.size });
      try {
        for (let step = 0; step < 6; step++) {
          update({ content: [{ type: 'text', text: Array.from({ length: 40 }, (_, row) => `TOOL_${args.index} PROGRESS_${step} ROW_${row}`).join('\n') }] });
          record('tool-progress', { index: args.index, step });
          await sleep(80 + args.index * 15);
        }
        return { content: [{ type: 'text', text: `TOOL_${args.index} FINAL_RECEIPT` }], details: {} };
      } finally {
        activeTools.delete(args.index);
      }
    },
  });
  pi.registerProvider('render-proof', {
    baseUrl: 'http://invalid.invalid', apiKey: 'synthetic', api: 'render-proof',
    models: [{ id: 'offline', name: 'Offline rendering test', reasoning: true, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 8192 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [{ type: 'text', text: '' }], api: model.api,
        provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      (async () => {
        if (!context.messages.some(item => item.role === 'toolResult')) {
          message.content = Array.from({ length: 6 }, (_, index) => ({ type: 'toolCall', id: `tool-${index}`, name: 'render_work', arguments: { index } }));
          message.stopReason = 'toolUse';
          stream.push({ type: 'done', reason: 'toolUse', message });
        } else {
          record('model-tool-results', { results: context.messages.filter(item => item.role === 'toolResult').map(item => ({ isError: item.isError, content: item.content })) });
          record('stream');
          stream.push({ type: 'start', partial: message });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          for (let row = 0; row < 100; row++) {
            const delta = `LIVE_ROW_${String(row).padStart(3, '0')} ${'Synthetic streamed output '.repeat(5)}\n\n`;
            message.content[0].text += delta;
            stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: message });
            record('stream-row', { row });
            await sleep(50);
          }
          stream.push({ type: 'text_end', contentIndex: 0, content: message.content[0].text, partial: message });
          stream.push({ type: 'done', reason: 'stop', message });
        }
        stream.end();
      })().catch(error => { record('error', { message: String(error) }); stream.end(); });
      return stream;
    },
  });
  let timer;
  pi.on('session_start', (_event, ctx) => {
    timer = setTimeout(() => {
      pi.sendMessage({ customType: 'render-history', content: Array.from({ length: 1200 }, (_, row) => `HISTORY_${row} ${'old synthetic content '.repeat(5)}`).join('\n'), display: true });
      record('ready');
    }, 300);
    ctx.ui.onTerminalInput(data => {
      if (data !== '\x1b[17~') return;
      record('draft', { text: ctx.ui.getEditorText() });
      return { consume: true };
    });
  });
  pi.on('agent_end', () => record('settled'));
  pi.on('session_shutdown', () => { clearTimeout(timer); process.stdout.write = originalWrite; });
}

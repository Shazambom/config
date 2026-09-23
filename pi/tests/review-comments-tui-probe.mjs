import { appendFileSync } from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

export default function (pi) {
  const record = (type, data) => appendFileSync(process.env.PI_REVIEW_PROOF, JSON.stringify({ type, ...data }) + '\n');
  pi.registerProvider('review-proof', {
    baseUrl: 'http://invalid.invalid', apiKey: 'synthetic', api: 'review-proof',
    models: [{ id: 'fixture', name: 'Offline review proof', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024 }],
    streamSimple(model, context) {
      record('request', { messages: context.messages });
      const stream = createAssistantMessageEventStream();
      const user = [...context.messages].reverse().find(message => message.role === 'user');
      const text = typeof user?.content === 'string' ? user.content : user?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '';
      const markers = [...text.matchAll(/\[review_comment id=([^ ]+) revision=([^\]]+)\]/g)];
      const resolve = context.messages.at(-1)?.role !== 'toolResult' && markers.length > 0;
      const message = { role: 'assistant', content: resolve ? markers.map((marker, index) => ({ type: 'toolCall', id: `resolve-${index}`, name: 'review_comments', arguments: { action: 'resolve', id: marker[1], revision: marker[2] } })) : [{ type: 'text', text: 'Synthetic feedback processed.' }], api: model.api, provider: model.provider, model: model.id, stopReason: resolve ? 'toolUse' : 'stop', timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'done', reason: message.stopReason, message });
      stream.end(message);
      return stream;
    },
  });
  pi.on('session_start', () => record('start', {}));
  pi.on('input', event => record('input', { text: event.text, source: event.source }));
  pi.on('tool_result', event => record('result', { tool: event.toolName, input: event.input, isError: event.isError, details: event.details }));
  pi.on('agent_end', () => record('end', {}));
}

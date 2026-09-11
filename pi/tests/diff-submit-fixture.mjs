import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, InMemoryCredentialStore } from '@earendil-works/pi-ai';

const [cwd, agentDir] = process.argv.slice(2);
const jiti = createJiti(import.meta.url);
const { registerDiffReviewCommand, registerViewCommand } = await jiti.import('../node_modules/pi-diff-review/src/index.ts');
const { buildGlobalComment } = await jiti.import('../node_modules/pi-diff-review/src/review/comments.ts');
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, agentsFilesOverride: () => ({ agentsFiles: [] }) });
await loader.reload();
const modelRuntime = await ModelRuntime.create({ agentDir, credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
await modelRuntime.setRuntimeApiKey('anthropic', 'synthetic-no-network');
const model = modelRuntime.getModel('anthropic', 'claude-sonnet-4-5');
assert(model);
const textOf = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
for (const commandName of ['diff', 'view']) {
  for (const busy of [false, true]) {
    const sessionManager = SessionManager.inMemory(cwd);
    const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model, noTools: 'all', resourceLoader: loader, sessionManager, settingsManager });
    const requests = [];
    let releaseFirst;
    let firstStarted;
    const started = new Promise(resolve => { firstStarted = resolve; });
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    session.agent.streamFunction = (_model, context) => {
      const stream = createAssistantMessageEventStream();
      requests.push(structuredClone(context.messages));
      const first = requests.length === 1;
      void (async () => {
        if (busy && first) {
          firstStarted();
          await firstGate;
        }
        const message = { role: 'assistant', content: [{ type: 'text', text: 'Synthetic response' }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
      })();
      return stream;
    };
    const sends = [];
    const deliveries = [];
    const commands = new Map();
    const pi = {
      registerCommand: (name, value) => commands.set(name, value),
      appendEntry: (type, data) => sessionManager.appendCustomEntry(type, data),
      sendUserMessage(content, options) {
        sends.push({ content, options });
        deliveries.push(session.sendUserMessage(content, options));
      },
    };
    registerDiffReviewCommand(pi);
    registerViewCommand(pi);
    const commentText = `Feedback ${commandName}/${busy}: keep \"quotes\" and café.\nSecond line.`;
    const comment = buildGlobalComment(commentText);
    let result = { action: 'cancel' };
    const ctx = { cwd, sessionManager, ui: { custom: async () => result, notify() {} } };
    const handler = commands.get(commandName).handler;
    const args = commandName === 'view' ? 'staged' : '';
    let running;
    try {
      if (busy) {
        running = session.prompt('Synthetic initial turn');
        await started;
        assert(session.isStreaming);
      }
      await handler(args, ctx);
      result = { action: 'submit', comments: [] };
      await handler(args, ctx);
      assert.equal(sends.length, 0);
      result = { action: 'submit', comments: [comment] };
      await handler(args, ctx);
      assert.equal(sends.length, 1);
      assert.deepEqual(sends[0].options, { deliverAs: 'steer' });
      assert(sends[0].content.includes(commentText));
      if (busy) {
        await Promise.all(deliveries);
        assert.deepEqual(session.getSteeringMessages(), [sends[0].content]);
        assert.equal(requests.length, 1);
        releaseFirst();
        await running;
      } else {
        await Promise.all(deliveries);
      }
      assert.equal(requests.length, busy ? 2 : 1);
      assert.equal(session.messages.filter(message => message.role === 'user' && textOf(message) === sends[0].content).length, 1);
      assert.equal(requests.at(-1).filter(message => message.role === 'user' && textOf(message) === sends[0].content).length, 1);
      assert.deepEqual(session.getSteeringMessages(), []);
      assert.equal(comment.text, commentText);
    } finally {
      releaseFirst();
      await running;
      session.dispose();
    }
  }
}
console.log('PASS: /diff and /view feedback starts idle turns, steers busy turns once, preserves comments, and ignores cancel/empty submissions.');

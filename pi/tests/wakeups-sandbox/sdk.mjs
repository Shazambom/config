import { pathToFileURL } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

export const contract = JSON.parse(readFileSync(new URL('./interface-v1.json', import.meta.url)));

export async function dependencies(pkg) {
  const sdk = await import(pathToFileURL(join(pkg, 'dist/index.js')));
  const ai = await import(pathToFileURL(join(pkg, 'node_modules/@earendil-works/pi-ai/dist/index.js')));
  return { sdk, ai };
}

export function clean(message) {
  const { errorMessage, diagnostics, ...rest } = message;
  return {
    ...rest,
    content: Array.isArray(rest.content)
      ? rest.content.filter(c => c.type !== 'thinking').map(c =>
        c.type === 'text' ? { type: 'text', text: c.text } : c)
      : rest.content,
  };
}

export async function open(deps, dir, mock, runtime, model, trace) {
  const { sdk } = deps;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const privateDir = mkdtempSync(join(dir, 'session-'));
  const cwd = join(privateDir, 'cwd');
  const agentDir = join(privateDir, 'agent');
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const resourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => contract.systemInstructions,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources() {},
    async reload() {},
  };
  const thinkingLevel = model.provider === 'sandbox-script' ? 'off' : 'low';
  const { session } = await sdk.createAgentSession({
    cwd, agentDir, modelRuntime: runtime, model, thinkingLevel, resourceLoader,
    sessionManager: sdk.SessionManager.inMemory(cwd),
    settingsManager: sdk.SettingsManager.inMemory({
      transport: 'sse',
      compaction: { enabled: false },
      cacheWarming: 'off',
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      enableAnalytics: false,
      enableInstallTelemetry: false,
    }),
    tools: contract.tools.map(t => t.name),
    customTools: contract.tools.map(t => ({
      ...t,
      label: t.name,
      executionMode: 'sequential',
      async execute(id, args) {
        const details = mock.call(t.name, args);
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
      },
    })),
  });
  assert.deepEqual(session.getActiveToolNames().sort(), contract.tools.map(t => t.name).sort());
  assert.equal(session.model.provider, model.provider);
  assert.equal(session.model.id, model.id);
  assert.equal(session.thinkingLevel, thinkingLevel, 'THINKING_LEVEL_UNSUPPORTED');
  let calls = 0;
  session.subscribe(e => {
    if (e.type !== 'message_end') return;
    trace.messages.push(clean(e.message));
    if (e.message.role === 'assistant') {
      calls += e.message.content.filter(c => c.type === 'toolCall').length;
    }
    if (calls > 32) {
      trace.limitExceeded = true;
      session.abort();
    }
  });
  return session;
}

export async function scripted(deps, trace, decide, gate) {
  const runtime = await deps.sdk.ModelRuntime.create({
    credentials: new deps.ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  let serial = 0;
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  runtime.registerProvider('sandbox-script', {
    baseUrl: 'http://127.0.0.1:1',
    api: 'openai-completions',
    apiKey: 'synthetic',
    models: [{
      id: 'wiring', name: 'wiring', reasoning: false, input: ['text'],
      cost, contextWindow: 100000, maxTokens: 512,
    }],
    streamSimple(model, context, options) {
      assert.equal(options.transport, 'sse');
      assert.equal(options.maxRetries, 0);
      assert.deepEqual(
        deps.ai.getCurrentTools(context.messages).map(t => t.name).sort(),
        contract.tools.map(t => t.name).sort(),
      );
      trace.inputs.push(context.messages.map(clean));
      const actions = decide(context.messages);
      const content = actions?.length
        ? actions.map(a => ({
          type: 'toolCall', id: `call-${++serial}`, name: a.name, arguments: a.args,
        }))
        : [{ type: 'text', text: 'Acknowledged.' }];
      const message = {
        role: 'assistant', content, api: model.api, provider: model.provider,
        model: model.id, stopReason: actions?.length ? 'toolUse' : 'stop',
        timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost },
      };
      const stream = deps.ai.createAssistantMessageEventStream();
      queueMicrotask(async () => {
        if (gate) await gate();
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      });
      return stream;
    },
  });
  return { runtime, model: runtime.getModel('sandbox-script', 'wiring') };
}

export async function bounded(session, action) {
  let timer;
  try {
    await Promise.race([
      (async () => {
        await action();
        await session.waitForIdle();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          session.abort();
          reject(new Error('DEADLINE'));
        }, 120000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function deliver(session, event, triggerTurn = true) {
  await session.sendCustomMessage({
    customType: 'wakeups', content: JSON.stringify(event), display: true, details: event,
  }, { triggerTurn, deliverAs: 'followUp' });
}

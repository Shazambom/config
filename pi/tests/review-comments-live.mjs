// SDK startup for the real Pi InteractiveMode. No provider or review-handler mocks.
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  ModelRuntime, InteractiveMode, SessionManager,
  createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices,
} from '@earendil-works/pi-coding-agent';

const proof = process.env.PI_REVIEW_PROOF;
const agentDir = process.env.PI_CODING_AGENT_DIR;
const cwd = process.cwd();
const receipt = (event) => appendFileSync(join(proof, 'events.jsonl'), `${JSON.stringify(event)}\n`);
const modelRuntime = await ModelRuntime.create({
  authPath: process.env.PI_REVIEW_AUTH_PATH,
  modelsPath: null,
  modelsStorePath: join(agentDir, 'models-store.json'),
  allowModelNetwork: false,
});
const model = modelRuntime.getModel('openai-codex', 'gpt-6-astra');
if (!model || !modelRuntime.hasConfiguredAuth(model.provider)) {
  throw new Error('Required openai-codex/gpt-6-astra model/auth unavailable; no provider fallback.');
}
const audit = (pi) => {
  pi.on('session_start', (_event, ctx) => {
    receipt({ type: 'ready', model: ctx.model?.id, provider: ctx.model?.provider,
      tools: pi.getActiveTools(), commands: pi.getCommands(),
      version: JSON.parse(readFileSync(new URL('../node_modules/@earendil-works/pi-coding-agent/package.json', import.meta.url))).version,
      startup: 'SDK InteractiveMode' });
  });
  for (const type of ['ui_prompt_start', 'ui_prompt_end', 'input', 'agent_start', 'agent_end', 'agent_settled', 'tool_execution_start', 'tool_execution_end']) {
    pi.on(type, (event) => { receipt(event); });
  }
  pi.on('before_agent_start', (event) => { receipt({ type: 'feedback', text: event.prompt }); });
  pi.on('message_end', (event) => { receipt(event); });
  pi.on('tool_call', (event) => {
    if (['read', 'edit', 'write'].includes(event.toolName)) {
      const path = resolve(cwd, event.input.path);
      if (path !== join(cwd, 'fixture.txt')) return { block: true, reason: 'Only fixture.txt is in scope.' };
    }
  });
};
const runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime,
    resourceLoaderOptions: { extensionFactories: [audit] },
  });
  if (services.diagnostics.some((item) => item.type === 'error')) throw new Error('Runtime resource errors');
  const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent,
    model, thinkingLevel: 'low', tools: ['read', 'edit', 'write', 'review_comments'],
  });
  if (result.extensionsResult.errors.length) throw new Error('Extension load errors');
  return { ...result, services, diagnostics: services.diagnostics };
}, { cwd, agentDir, sessionManager: SessionManager.create(cwd, join(proof, 'sessions')) });
await new InteractiveMode(runtime, { migratedProviders: [] }).run();

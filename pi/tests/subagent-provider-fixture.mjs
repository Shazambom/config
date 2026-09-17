import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { ModelRuntime, ModelRegistry, SessionManager, createAgentSession, DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, createAssistantMessageEventStream } from '@earendil-works/pi-ai';

let networkRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('Network disabled in provider fixture'); };
const root = process.argv[2];
const jiti = createJiti(import.meta.url, { alias: {
  '@mariozechner/pi-tui': import.meta.resolve('@earendil-works/pi-tui').replace('file://', ''),
  '@mariozechner/pi-coding-agent': import.meta.resolve('@earendil-works/pi-coding-agent').replace('file://', ''),
  '@mariozechner/pi-ai': import.meta.resolve('@earendil-works/pi-ai').replace('file://', ''),
  '@sinclair/typebox': import.meta.resolve('typebox').replace('file://', ''),
} });
const { preflightModel, modelOptions, permanentProviderFailure } = await jiti.import(join(root, 'pi-extension/subagents/model-preflight.ts'));
const childExtension = (await jiti.import(join(root, 'pi-extension/subagents/subagent-done.ts'))).default;
const temp = mkdtempSync(join(tmpdir(), 'pi-provider-fixture-'));
const syntheticModel = { id: 'test', name: 'test', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 };
try {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify('openai-codex', async () => ({ type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh', expires: Date.now() + 3600000, accountId: 'fixture' }));
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
  const registry = new ModelRegistry(runtime);
  const model = registry.getAll().find(m => m.provider === 'openai-codex');
  assert(model);
  const ctx = { model, modelRegistry: registry };
  assert.equal(await preflightModel(ctx), `${model.provider}/${model.id}`);
  const missing = registry.getAll().find(m => m.provider === 'openrouter');
  assert(missing);
  await assert.rejects(preflightModel(ctx, `${missing.provider}/${missing.id}`), /missing provider credentials.*openai-codex/s);
  await assert.rejects(preflightModel(ctx, 'unsupported/not-a-model'), /unknown or ambiguous/);
  await credentials.modify('anthropic', async () => ({ type: 'api_key', key: 'synthetic-key' }));
  await runtime.refresh({ allowNetwork: false });
  const second = registry.getAll().find(m => m.provider === 'anthropic');
  assert.equal(await preflightModel(ctx, `${second.provider}/${second.id}`), `${second.provider}/${second.id}`);
  assert.match(modelOptions(ctx), /anthropic\//);
  assert(!modelOptions(ctx).includes('openrouter/'));
  assert(!modelOptions(ctx).includes('synthetic-'));
  runtime.registerProvider('fixture-custom', { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'synthetic-custom', models: [{ id: 'test', name: 'test', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 }] });
  assert.equal(await preflightModel(ctx, 'fixture-custom/test'), 'fixture-custom/test');
  process.env.ANTHROPIC_API_KEY = 'synthetic-env';
  const envRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
  assert.equal(await preflightModel({ model: second, modelRegistry: new ModelRegistry(envRuntime) }), `${second.provider}/${second.id}`);
  delete process.env.ANTHROPIC_API_KEY;

  let refreshes = 0;
  runtime.registerProvider('refreshable', { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', models: [syntheticModel], oauth: {
    name: 'Synthetic OAuth', login: async () => { throw new Error('not used'); },
    refreshToken: async old => { refreshes++; return { ...old, access: 'refreshed', expires: Date.now() + 3600000 }; },
    getApiKey: c => c.access,
  } });
  await credentials.modify('refreshable', async () => ({ type: 'oauth', access: 'expired', refresh: 'synthetic', expires: 1 }));
  await runtime.refresh({ allowNetwork: false });
  assert.equal(await preflightModel(ctx, 'refreshable/test'), 'refreshable/test');
  assert.equal(refreshes, 1, 'Refreshable OAuth must be resolved, not rejected for expiry');

  for (const message of ['401 Unauthorized', '403 Forbidden', 'No API key found for provider', 'Provider is not configured: example', 'Unknown provider: example', 'invalid_api_key']) assert(permanentProviderFailure(message));
  for (const message of ['429 rate limit', '503 overloaded', 'connection reset', 'OAuth refresh timed out']) assert(!permanentProviderFailure(message));
  process.env.PI_SUBAGENT_AUTO_EXIT = '1';
  process.env.PI_SUBAGENT_SESSION = join(temp, 'child.jsonl');
  const handlers = new Map();
  childExtension({ on: (name, fn) => handlers.set(name, fn), registerShortcut() {}, registerTool() {} });
  let closed = 0;
  let aborted = 0;
  const childCtx = { ...ctx, abort() { aborted++; }, shutdown() { closed++; } };
  const message = { role: 'assistant', stopReason: 'error', errorMessage: '401 synthetic-secret overloaded' };
  const replacement = handlers.get('message_end')({ message }, childCtx);
  assert(!replacement.message.errorMessage.includes('synthetic-secret'));
  handlers.get('agent_end')({ messages: [message] }, childCtx);
  handlers.get('agent_end')({ messages: [message] }, childCtx);
  assert.equal(closed, 1);
  assert.equal(aborted, 1);
  assert(!readFileSync(`${process.env.PI_SUBAGENT_SESSION}.exit`, 'utf8').includes('synthetic-secret'));
  const startupHandlers = new Map();
  childExtension({ on: (name, fn) => startupHandlers.set(name, fn), registerShortcut() {}, registerTool() {} });
  let startupClosed = 0;
  const inputResult = await startupHandlers.get('input')({ text: 'never sent' }, { model: missing, modelRegistry: registry, abort() {}, shutdown() { startupClosed++; } });
  assert.equal(inputResult.action, 'handled');
  assert.equal(startupClosed, 1, 'Missing child credentials must close before its first model request');

  // Run the child hook through the real SDK retry loop with a synthetic provider.
  let requests = 0;
  const syntheticProvider = { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'synthetic', models: [syntheticModel], streamSimple: model => {
    requests++;
    const stream = createAssistantMessageEventStream();
    const error = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, stopReason: 'error', errorMessage: '401 Unauthorized overloaded synthetic-secret', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    queueMicrotask(() => { stream.push({ type: 'error', reason: 'error', error }); stream.end(); });
    return stream;
  } };
  runtime.registerProvider('permanent-fixture', syntheticProvider);
  assert.equal(await preflightModel({ model: runtime.getModel('permanent-fixture', 'test'), modelRegistry: registry }), 'permanent-fixture/test');
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 5, baseDelayMs: 1 }, compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: temp, agentDir: temp, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, extensionFactories: [pi => { pi.registerProvider('permanent-fixture', syntheticProvider); childExtension(pi); }] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: temp, agentDir: temp, modelRuntime: runtime, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(temp), model: runtime.getModel('permanent-fixture', 'test') });
  let shutdowns = 0;
  await session.bindExtensions({ mode: 'print', shutdownHandler: () => { shutdowns++; } });
  await session.prompt('synthetic only');
  assert.equal(requests, 1, `Permanent auth error must not enter automatic retries: ${JSON.stringify(session.messages)}`);
  assert.equal(shutdowns, 1);
  session.dispose();
  delete process.env.PI_SUBAGENT_AUTO_EXIT;
  delete process.env.PI_SUBAGENT_SESSION;
  const agentsDir = join(process.env.PI_CODING_AGENT_DIR, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, 'fixture.md'), '---\nname: fixture\ndescription: test\n---\nTest only.\n');
  writeFileSync(join(agentsDir, 'unsupported.md'), '---\nname: unsupported\ndescription: test\nmodel: absent/model\n---\nTest only.\n');
  const tools = new Map();
  const extension = await jiti.import(join(root, 'pi-extension/subagents/index.ts'));
  extension.default({ on() {}, registerTool: tool => tools.set(tool.name, tool), registerCommand() {}, registerMessageRenderer() {} });
  const sessionManager = SessionManager.create(temp, join(temp, 'sessions'));
  const parentCtx = { ...ctx, cwd: temp, sessionManager };
  const spawn = args => tools.get('subagent').execute('fixture', args, undefined, undefined, parentCtx);
  await assert.rejects(spawn({ agent: 'fixture', model: `${missing.provider}/${missing.id}`, task: 'never launched' }), /missing provider credentials/);
  await assert.rejects(spawn({ agent: 'unsupported', task: 'never launched' }), /absent\/model/);
  await assert.rejects(spawn({ agent: 'fixture', model: 'unknown/model', task: 'never launched' }), /unknown or ambiguous/);
  assert(!existsSync(join(sessionManager.getSessionDir(), 'artifacts')), 'Failed launches must not allocate artifacts');
  const inherited = { agent: 'fixture', task: 'never launched' };
  delete process.env.TMUX;
  await spawn(inherited);
  assert.equal(inherited.model, `${model.provider}/${model.id}`);
  const sessionHelpers = await jiti.import(join(root, 'pi-extension/subagents/session.ts'));
  const artifactDir = join(sessionManager.getSessionDir(), 'artifacts', sessionManager.getSessionId());
  const savedSession = join(temp, 'saved.jsonl');
  writeFileSync(savedSession, '');
  sessionHelpers.registerName(artifactDir, 'saved', { sessionFile: savedSession, sessionId: 'saved' });
  sessionHelpers.writeSubagentLoadout(savedSession, { model: `${missing.provider}/${missing.id}`, toolAllowlist: 'read', agent: 'fixture' });
  const bin = join(temp, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\necho forbidden > "' + join(temp, 'pane-call') + '"\nexit 99\n', { mode: 0o700 });
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.TMUX = join(temp, 'nonexistent-socket');
  await assert.rejects(tools.get('subagent_message').execute('resume', { name: 'saved', message: 'never launched' }, undefined, undefined, parentCtx), /missing provider credentials/);
  assert(!existsSync(join(temp, 'pane-call')), 'Preflight must not call tmux');
  let parentTurns = 0;
  const toolProvider = { ...syntheticProvider, streamSimple: model => {
    const stream = createAssistantMessageEventStream();
    const first = parentTurns++ === 0;
    const message = { role: 'assistant', content: first ? [{ type: 'toolCall', id: 'missing-auth', name: 'subagent', arguments: { agent: 'fixture', model: `${missing.provider}/${missing.id}`, task: 'never launched' } }] : [{ type: 'text', text: 'done' }], api: model.api, provider: model.provider, model: model.id, stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    queueMicrotask(() => { stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); });
    return stream;
  } };
  const parentLoader = new DefaultResourceLoader({ cwd: temp, agentDir: temp, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, extensionFactories: [pi => { pi.registerProvider('permanent-fixture', toolProvider); extension.default(pi); }] });
  await parentLoader.reload();
  const parentSession = (await createAgentSession({ cwd: temp, agentDir: temp, modelRuntime: runtime, resourceLoader: parentLoader, settingsManager, sessionManager: SessionManager.inMemory(temp), model: runtime.getModel('permanent-fixture', 'test') })).session;
  await parentSession.bindExtensions({ mode: 'print' });
  await parentSession.prompt('synthetic tool call');
  const toolResult = parentSession.messages.find(m => m.role === 'toolResult');
  assert.equal(toolResult?.isError, true, 'Actual SDK tool loop must mark preflight failures isError');
  assert.match(JSON.stringify(toolResult.content), /missing provider credentials/);
  assert(!existsSync(join(temp, 'pane-call')));
  await parentSession.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  parentSession.dispose();
  assert.equal(networkRequests, 0, 'No network/auth/model calls are allowed');
  console.log('PASS: SDK OAuth/API key/env/custom auth and OAuth refresh; spawn/resume no-pane failures and parent inheritance; actual tool isError; permanent child error closes once without retries.');
} finally { rmSync(temp, { recursive: true, force: true }); }

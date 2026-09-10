import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createJiti } from 'jiti';

const runtimeDir = process.argv[2];
const { ModelRuntime, ModelRegistry, createEventBus } = await import(pathToFileURL(join(runtimeDir, 'dist/index.js')));
const { loadExtensions } = await import(pathToFileURL(join(runtimeDir, 'dist/core/extensions/loader.js')));
const { visibleWidth } = await import('@earendil-works/pi-tui');
const wrapper = fileURLToPath(new URL('../overrides/quotas.ts', import.meta.url));
const calls = [];
let responseMode = 'success';
const reset = '2030-01-02T00:00:00Z';
const sensitive = 'fixture-secret-never-display';
globalThis.fetch = async (url, init) => {
  assert(['https://api.anthropic.com/api/oauth/usage', 'https://chatgpt.com/backend-api/wham/usage'].includes(url), 'Unexpected network destination');
  const anthropic = url.includes('anthropic');
  assert.equal(init.method ?? 'GET', 'GET');
  assert.equal(init.headers.Authorization, anthropic ? 'Bearer sk-ant-oat-fixture' : 'Bearer codex-fixture');
  if (anthropic) assert.equal(init.headers['anthropic-beta'], 'oauth-2025-04-20');
  else assert.equal(init.headers['ChatGPT-Account-Id'], 'account-fixture');
  calls.push({ url, signal: init.signal });
  if (responseMode === 'network') throw new Error(sensitive);
  if (responseMode === 'cancel') {
    const error = new DOMException('Request cancelled', 'AbortError');
    throw error;
  }
  if (responseMode === 'malformed') return new Response('{');
  if (typeof responseMode === 'number') return new Response(JSON.stringify({ error: { message: sensitive } }), { status: responseMode, statusText: sensitive });
  return Response.json(anthropic ? {
    five_hour: { utilization: 25, resets_at: reset },
    seven_day: { utilization: 40, resets_at: reset },
  } : { rate_limit: {
    primary_window: { used_percent: 60, reset_at: 1893542400, limit_window_seconds: 18000 },
    secondary_window: { used_percent: 80, reset_at: 1893542400, limit_window_seconds: 604800 },
  } });
};

const result = await loadExtensions([wrapper], process.cwd(), createEventBus());
assert.deepEqual(result.errors, []);
assert.equal(result.extensions.length, 1);
const extension = result.extensions[0];
assert.equal(extension.handlers.size, 0, 'Command-only quotas must not install lifecycle hooks or poll');
assert.equal(extension.tools.size, 0);
const commands = extension.commands;
assert.deepEqual([...commands.keys()].sort(), ['anthropic:quotas', 'codex:quotas', 'quotas', 'usage']);
assert.equal(commands.get('usage').handler, commands.get('quotas').handler);
assert.equal(calls.length, 0, 'Loading extension must not fetch');

const runtime = await ModelRuntime.create({ agentDir: process.env.PI_CODING_AGENT_DIR, allowModelNetwork: false });
const registry = new ModelRegistry(runtime);
const theme = { fg: (_color, text) => text, bold: text => text };
const notifications = [];
let refresh = false;
let rendered = '';
const ctx = {
  mode: 'tui', hasUI: true, cwd: process.cwd(), modelRegistry: registry,
  ui: {
    notify: text => notifications.push(text),
    custom: async factory => {
      let component;
      let resolveLoaded;
      let loaded = new Promise(resolve => { resolveLoaded = resolve; });
      let closed = false;
      const tui = { requestRender() {
        queueMicrotask(() => {
          if (!component || closed) return;
          const lines = component.render(100);
          if (lines.some(line => line.includes('Fetching quotas...'))) return;
          rendered = lines.join('\n');
          resolveLoaded();
        });
      } };
      component = factory(tui, theme, {}, () => { closed = true; });
      try {
        await loaded;
        if (refresh) {
          loaded = new Promise(resolve => { resolveLoaded = resolve; });
          component.handleInput('r');
          await loaded;
        }
        for (const width of [1, 20, 60, 100]) {
          assert(component.render(width).every(line => visibleWidth(line) <= width), 'Dashboard exceeded terminal width');
        }
        assert(!rendered.includes(sensitive), 'Sensitive failure text reached dashboard');
        component.handleInput('q');
        assert(closed);
        return null;
      } finally { component.dispose(); }
    },
  },
};

for (const mode of ['print', 'json', 'rpc']) {
  for (const command of commands.values()) await command.handler('', { ...ctx, mode });
}
for (const key of ['PI_SUBAGENT_AGENT', 'OM_WORKER']) {
  process.env[key] = 'fixture';
  for (const command of commands.values()) await command.handler('', ctx);
  delete process.env[key];
}
assert.equal(calls.length, 0, 'Noninteractive and worker invocations must not fetch');
await commands.get('usage').handler('', ctx);
assert.equal(calls.length, 2);
assert(rendered.includes('Anthropic') && rendered.includes('OpenAI Codex'));
assert(rendered.includes('75% left') && rendered.includes('20% left'));
assert(rendered.includes('5h:') && rendered.includes('7d:') && rendered.includes('Resets in'));
assert(calls.every(call => call.signal.aborted), 'Closing dashboard must abort its requests');
await commands.get('quotas').handler('', ctx);
assert.equal(calls.length, 2, 'Reopening uses upstream per-provider cache');
refresh = true;
await commands.get('usage').handler('', ctx);
assert.equal(calls.length, 4, 'Manual refresh bypasses cache');
for (const mode of [401, 429, 'network', 'malformed', 'cancel']) {
  responseMode = mode;
  await commands.get('anthropic:quotas').handler('', ctx);
  assert(!rendered.includes('OpenAI Codex'));
  assert(rendered.includes(typeof mode === 'number' ? `HTTP ${mode}` : mode === 'cancel' ? 'Request cancelled' : 'Quota request failed'));
}
responseMode = 'success';
await commands.get('codex:quotas').handler('', ctx);
assert(rendered.includes('OpenAI Codex') && !rendered.includes('Anthropic'));

// Direct upstream APIs cover missing credentials and both registry compatibility paths.
const jiti = createJiti(import.meta.url);
const { quotaAuthStorage } = await jiti.import('../node_modules/@latentminds/pi-quotas/src/lib/auth.ts');
const { fetchAnthropicQuotasWithToken, fetchCodexQuotasWithToken } = await jiti.import('../node_modules/@latentminds/pi-quotas/src/providers/fetch.ts');
const { clearQuotaCache, fetchProviderQuotas } = await jiti.import('../node_modules/@latentminds/pi-quotas/src/lib/quotas.ts');
const before = calls.length;
assert.equal((await fetchAnthropicQuotasWithToken()).error.kind, 'config');
assert.equal((await fetchAnthropicQuotasWithToken('sk-ant-api-fixture')).error.kind, 'not_applicable');
assert.equal((await fetchCodexQuotasWithToken('codex-fixture')).error.kind, 'config');
assert.equal(calls.length, before);
const legacy = { getApiKey: async () => 'legacy-fixture' };
assert.equal(quotaAuthStorage({ authStorage: legacy }), legacy);
const headers = quotaAuthStorage({ getProviderAuth: async () => ({ auth: { headers: { Authorization: 'Bearer headers-fixture' } } }) });
assert.equal(await headers.getApiKey('anthropic'), 'headers-fixture');
assert.equal(quotaAuthStorage(registry).get('openai-codex').accountId, 'account-fixture');
for (const code of ['oauth', 'other']) {
  clearQuotaCache();
  const error = Object.assign(new Error(sensitive), { code });
  const failure = await fetchProviderQuotas({ getApiKey: async () => { throw error; } }, 'anthropic');
  assert(!failure.success && !failure.error.message.includes(sensitive));
}
assert.equal(calls.length, before);
const version = JSON.parse(readFileSync(join(runtimeDir, 'package.json'), 'utf8')).version;
console.log(`PASS: quotas on Pi ${version}: real extension loader/auth registry, both providers, aliases, headless guards, refresh, cancellation, error redaction and widths`);

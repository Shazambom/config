import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Mock } from './mock.mjs';
import { Scorer } from './score.mjs';
import { bounded, clean, dependencies, open } from './sdk.mjs';
import { fingerprint } from './fingerprint.mjs';

export async function regressions(pkg, out) {
  const deps = await dependencies(pkg);
  const results = [];
  async function check(name, test) {
    try {
      await test();
      results.push({ name, status: 'PASS' });
    } catch (error) {
      results.push({ name, status: 'FAIL', code: error.code ?? error.name });
    }
  }
  mkdirSync(out, { recursive: true, mode: 0o700 });
  await check('diagnostics redaction', () => {
    const secret = 'SYNTHETIC_SECRET_DIAGNOSTIC';
    const message = {
      role: 'assistant', content: [{ type: 'text', text: 'safe' }],
      errorMessage: secret, diagnostics: [{ error: { message: secret, stack: secret } }],
    };
    for (const section of ['messages', 'history', 'inputs']) {
      assert(!JSON.stringify({ [section]: [clean(message)] }).includes(secret));
    }
  });
  await check('SDK diagnostics absent from recorded messages history and provider inputs', async () => {
    const secret = 'SYNTHETIC_SDK_DIAGNOSTIC_SECRET';
    const trace = { messages: [], inputs: [] };
    const runtime = await deps.sdk.ModelRuntime.create({
      credentials: new deps.ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false,
    });
    const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let calls = 0;
    runtime.registerProvider('sandbox-script', {
      api: 'openai-completions', apiKey: 'synthetic', baseUrl: 'http://127.0.0.1:1',
      models: [{ id: 'diagnostics', name: 'diagnostics', reasoning: false, input: ['text'], cost, contextWindow: 100000, maxTokens: 512 }],
      streamSimple(model, context) {
        trace.inputs.push(context.messages.map(clean));
        const first = calls++ === 0;
        const message = {
          role: 'assistant', api: model.api, provider: model.provider, model: model.id,
          content: first ? [{ type: 'toolCall', id: 'list-1', name: 'wake_list', arguments: {} }] : [{ type: 'text', text: 'Done' }],
          stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(),
          diagnostics: [{ error: { message: secret, stack: secret } }],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost },
        };
        const stream = deps.ai.createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: 'done', reason: message.stopReason, message });
          stream.end();
        });
        return stream;
      },
    });
    const session = await open(deps, join(out, 'workspaces'), new Mock({ now: '2026-10-19T12:00:00Z' }), runtime, runtime.getModel('sandbox-script', 'diagnostics'), trace);
    try {
      await bounded(session, () => session.prompt('List my timers.'));
      assert.equal(calls, 2);
      assert(JSON.stringify(session.messages).includes(secret), 'The test must actually inject the sentinel');
      trace.history = session.messages.map(clean);
      assert(!JSON.stringify(trace).includes(secret));
      writeFileSync(join(out, 'sanitized-sdk-trace.json'), JSON.stringify(trace, null, 2));
    } finally {
      session.dispose();
    }
  });
  for (const text of ['line one\nline two', 'one\ttwo', 'path\\file', 'quotes "here"']) {
    await check(`user text ${JSON.stringify(text)}`, () => {
      const step = { input: { user: text }, expect: { calls: [], events: 0 } };
      for (const content of [text, [{ type: 'text', text }]]) {
        assert.equal(new Scorer({ now: '2026-10-19T12:00:00Z' }).step(step, {
          messages: [], history: [], events: [], inputs: [[{ role: 'user', content }]],
        }), 'PASS');
      }
    });
  }
  await check('assistant text is not original user input', () => {
    assert.throws(() => new Scorer({ now: '2026-10-19T12:00:00Z' }).step({
      input: { user: 'original task' }, expect: { calls: [], events: 0 },
    }, { messages: [], history: [], events: [], inputs: [[{ role: 'assistant', content: 'original task' }]] }), /ORIGINAL_TASK_LOST/);
  });
  await check('termination keys and values', () => {
    for (const termination of [
      { exit_code: 0, signal: null }, { exit_code: null, signal: 'SIGTERM' },
      { exit_code: 0, extra: true }, { signal: '' }, { exit_code: 1.5 }, {}, null,
    ]) {
      const mock = new Mock({ now: '2026-10-19T12:00:00Z' });
      mock.call('watch_shell', { command: './a', on_exit: 'Report' });
      assert.throws(() => mock.exit(termination), /INVALID_TERMINATION/);
    }
  });
  await check('foreground compound command stays inert', () => {
    const mock = new Mock({ now: '2026-10-19T12:00:00Z' });
    assert.equal(mock.call('watch_shell', { command: './a && ./b', on_exit: 'Report' }).status, 'running');
  });
  await check('provider file mutation changes package fingerprint', () => {
    const tree = join(out, 'package-copy');
    const provider = 'node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js';
    mkdirSync(join(tree, 'dist/core'), { recursive: true });
    mkdirSync(join(tree, 'node_modules/@earendil-works/pi-ai/dist/api'), { recursive: true });
    copyFileSync(join(pkg, 'dist/core/sdk.js'), join(tree, 'dist/core/sdk.js'));
    copyFileSync(join(pkg, provider), join(tree, provider));
    const before = fingerprint(tree);
    writeFileSync(join(tree, provider), `${readFileSync(join(tree, provider), 'utf8')}\n// Offline mutation\n`);
    const after = fingerprint(tree);
    assert.notEqual(after, before);
    writeFileSync(join(out, 'fingerprint-mutation.json'), JSON.stringify({ before, after }, null, 2));
  });
  for (const failure of ['network', 429, 500, 502, 503, 504, 'overflow', 'broken-stream']) {
    await check(`Codex SSE single outbound attempt ${failure}`, async () => {
      const savedFetch = globalThis.fetch;
      const savedWebSocket = globalThis.WebSocket;
      let http = 0;
      let websocket = 0;
      let requests = 0;
      const optionsSeen = [];
      globalThis.fetch = async () => {
        http++;
        if (failure === 'network') throw new Error('synthetic connection refused');
        if (failure === 'overflow') {
          return new Response('{"error":{"message":"maximum context length exceeded"}}', { status: 400 });
        }
        if (failure === 'broken-stream') {
          return new Response(new ReadableStream({
            start(controller) { controller.error(new Error('synthetic stream disconnect')); },
          }), { status: 200 });
        }
        return new Response('{"error":{"message":"synthetic service unavailable"}}', { status: failure });
      };
      globalThis.WebSocket = class {
        constructor() {
          websocket++;
          throw new Error('synthetic websocket unavailable');
        }
      };
      let session;
      try {
        const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic' } })).toString('base64url');
        const credentials = new deps.ai.InMemoryCredentialStore();
        await credentials.modify('openai-codex', () => ({ type: 'oauth', access: `synthetic.${payload}.synthetic`, refresh: 'synthetic', expires: Date.now() + 3600000 }));
        const runtime = await deps.sdk.ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
        const original = runtime.streamSimple;
        runtime.streamSimple = function(model, context, options) {
          requests++;
          optionsSeen.push({ transport: options.transport, maxRetries: options.maxRetries });
          return original.call(this, model, context, options);
        };
        const trace = { messages: [], inputs: [] };
        session = await open(deps, join(out, 'workspaces'), new Mock({ now: '2026-10-19T12:00:00Z' }), runtime, runtime.getModel('openai-codex', 'gpt-6-sol'), trace);
        await bounded(session, () => session.prompt('Reply briefly.'));
        assert.deepEqual(optionsSeen, [{ transport: 'sse', maxRetries: 0 }]);
        assert.equal(requests, 1);
        assert.equal(http, 1);
        assert.equal(websocket, 0);
        assert.equal(trace.messages.filter(m => m.role === 'assistant').length, 1);
        assert.equal(trace.messages.at(-1).stopReason, 'error');
        assert.equal(session.messages.at(-1).stopReason, 'error');
      } finally {
        session?.dispose();
        globalThis.fetch = savedFetch;
        globalThis.WebSocket = savedWebSocket;
        writeFileSync(join(out, `transport-${failure}.json`), JSON.stringify({ requests, http, websocket, optionsSeen }, null, 2));
      }
    });
  }
  writeFileSync(join(out, 'regressions.json'), JSON.stringify(results, null, 2));
  assert(results.every(result => result.status === 'PASS'), 'Targeted regression failed; see regressions.json');
  console.log(`PASS ${results.length} targeted regressions`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await regressions(process.argv[2], process.argv[3]);
}

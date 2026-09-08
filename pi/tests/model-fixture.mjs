// Deliberate JS exception: exercise upstream TS APIs and emulate streaming
// OpenAI tool calls. Bash owns setup/processes/files; jq owns configuration JSON.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';

const [fixture] = process.argv.slice(2);
const jiti = createJiti(import.meta.url);
const load = p => jiti.import(fileURLToPath(new URL('../node_modules/' + p, import.meta.url)));
const sub = (await load('pi-subagents/src/extension/config.ts')).loadConfig();
assert.equal(sub.asyncByDefault, false);
assert.equal(sub.maxSubagentDepth, 1);
assert.equal(sub.globalConcurrencyLimit, 3);
assert.equal(sub.maxSubagentSpawnsPerRun, 3);
assert.equal(sub.maxSubagentSpawnsPerSession, 12);
assert.equal(sub.scheduledRuns.enabled, false);
assert.equal(sub.authorityPolicy.scheduleCreate, 'forbid');
const discovery = (await load('pi-subagents/src/agents/agents.ts')).discoverAgents(process.cwd(), 'user');
assert.deepEqual(discovery.agents.map(a => a.name).sort(), ['oracle', 'researcher', 'reviewer', 'scout']);
assert.equal((await load('pi-web-access/gemini-web-config.ts')).isBrowserCookieAccessAllowed(), false);
assert.equal((await load('pi-web-access/youtube-extract.ts')).isYouTubeEnabled(), false);
assert.equal((await load('pi-web-access/video-extract.ts')).isVideoFile('/tmp/private.mp4'), null);
assert.equal((await load('pi-web-access/feature-config.ts')).isImageEnabled(), false);
const pdf = (await load('pi-web-access/pdf-extract.ts')).loadPDFConfig();
assert.equal(pdf.provider, 'unpdf');
assert.equal(pdf.maxPages, 40);

const rolesSeen = new Set();
let parentSteps = 0;
const steps = [
  ...['scout', 'reviewer', 'oracle', 'researcher'].map(role => ({
    name: 'subagent', args: { agent: role, task: `ROLE:${role} Read ${fixture} and return its evidence.`, async: false, timeoutMs: 60000, agentScope: 'user' },
  })),
  { name: 'subagent', args: {
    workflowScript: `return await runs.all(${JSON.stringify(['scout', 'reviewer'].map(role => ({ key: role, agent: role, task: `ROLE:${role} Read ${fixture}` })))})`,
    async: false, timeoutMs: 60000, agentScope: 'user',
  } },
  { name: 'fetch_content', args: { url: 'http://127.0.0.1:9/private' } },
];
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const tools = body.tools.map(t => t.function.name);
    const parent = tools.includes('subagent');
    const results = body.messages.filter(m => m.role === 'tool');
    let call;
    let text;
    if (parent) {
      for (const name of ['web_search', 'fetch_content', 'get_search_content', 'source_check']) assert(tools.includes(name), `Missing ${name}`);
      if (results.length) {
        const last = JSON.stringify(results.at(-1));
        if (results.length <= 5) assert.match(last, /CHILD_OK/, last);
        else assert.match(last, /blocked|private|loopback|not allowed|SSRF/i, last);
      }
      call = steps[results.length];
      parentSteps = results.length;
      text = 'EXTENSIONS_OK';
      if (!call) {
        assert.equal(parentSteps, steps.length);
        assert.equal(rolesSeen.size, 4);
        console.log('PASS');
      }
    } else {
      const task = body.messages.filter(m => m.role === 'user').map(m => JSON.stringify(m.content)).join('\n');
      const role = task.match(/ROLE:(scout|reviewer|oracle|researcher)/)?.[1];
      assert(role, `Unrecognized child task: ${task}`);
      rolesSeen.add(role);
      const expected = role === 'researcher'
        ? ['read', 'web_search', 'fetch_content', 'get_search_content', 'source_check']
        : ['read', 'grep', 'find', 'ls'];
      assert.deepEqual([...tools].sort(), expected.sort(), `${role} tool restrictions`);
      if (!results.length) call = { name: 'read', args: { path: fixture } };
      else assert.match(JSON.stringify(results.at(-1)), /PORTABLE_PI_CHILD_EVIDENCE/);
      text = 'CHILD_OK';
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'smoke', object: 'chat.completion.chunk', created: 0, model: 'smoke',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant' });
    if (call) send({ tool_calls: [{ index: 0, id: `call_${parentSteps}_${Date.now()}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] });
    else send({ content: text });
    send({}, call ? 'tool_calls' : 'stop');
    res.end('data: [DONE]\n\n');
  } catch (error) {
    console.error(error);
    res.writeHead(400);
    res.end(String(error));
  }
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));

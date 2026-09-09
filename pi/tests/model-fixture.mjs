import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Portable Pi fixture</title></head><body><article><h1>Portable Pi evidence</h1><p>A local page used to verify page extraction and browser interaction without sending data to a hosted service. The fixture exercises the extraction library on a complete HTML document with a title and article text. Tests verify that the returned Markdown includes the article heading and body rather than an error or an empty result. Browser tests navigate to this page, fill in the text field, press the button, and inspect the document title. They also check that console output and the request are captured. All content is synthetic and served by a loopback HTTP server. No private user data or external credentials are involved in the offline tests.</p><input id="name"><button onclick="document.title=document.querySelector(\'#name\').value; console.log(\'clicked\')">Save</button></article></body></html>');
      return;
    }
    assert.equal(req.url, '/v1/chat/completions');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.model, 'smoke');
    const tools = (body.tools ?? []).map(t => t.function.name);
    const results = body.messages.filter(m => m.role === 'tool');
    const text = JSON.stringify(body.messages);
    let call;
    if (tools.includes('record_observations')) {
      assert.deepEqual(tools, ['record_observations']);
      if (!results.length) call = { name: 'record_observations', args: { observations: [{ timestamp: '2026-01-01 12:00', content: 'Portable Pi memory evidence.' }] } };
    } else if (text.includes('CONSOLIDATOR_FIXTURE')) {
      assert.deepEqual([...tools].sort(), ['edit', 'grep', 'ls', 'read', 'write']);
      if (!results.length) call = { name: 'write', args: { path: 'fixture.md', content: '# Memory fixture\nPortable Pi memory evidence.\n' } };
    } else if (text.includes('ROLE:scout')) {
      assert.deepEqual([...tools].sort(), ['ask_question', 'find', 'grep', 'ls', 'read']);
      if (!results.length) call = { name: 'read', args: { path: 'evidence.txt' } };
      else assert.match(JSON.stringify(results), /PORTABLE_PI_CHILD_EVIDENCE/);
    } else if (text.includes('ROLE:worker')) {
      for (const tool of ['edit', 'write', 'bash', 'subagent', 'subagent_message', 'subagents_list', 'web_search', 'web_fetch']) assert(tools.includes(tool), `Worker missing ${tool}`);
      if (!results.length) call = { name: 'write', args: { path: 'worker-evidence.txt', content: 'WORKER_OK\n' } };
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'smoke', object: 'chat.completion.chunk', created: 0, model: 'smoke',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant' });
    if (call) send({ tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] });
    else send({ content: 'FIXTURE_OK' });
    send({}, call ? 'tool_calls' : 'stop');
    res.end('data: [DONE]\n\n');
  } catch (error) {
    console.error(error);
    res.writeHead(400);
    res.end('Fixture assertion failed');
  }
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));

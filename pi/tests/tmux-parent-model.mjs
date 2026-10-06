// Local OpenAI SSE fixture. Also preloaded by every Pi process to deny remote TCP.
import { createServer } from 'node:http';
import net from 'node:net';
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

if (process.env.PI_TMUX_PROOF) {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // Node may pass its normalized [options, callback] tuple internally.
    const input = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof input[0] === 'object' ? input[0] : { port: input[0], host: typeof input[1] === 'string' ? input[1] : undefined };
    const host = options.host ?? options.hostname ?? 'localhost';
    if (!options.path && !['localhost', '127.0.0.1', '::1'].includes(host)) {
      appendFileSync(`${process.env.PI_TMUX_PROOF}/network-denied.jsonl`, JSON.stringify({ host }) + '\n');
      throw new Error(`Offline fixture denied TCP to ${host}`);
    }
    return connect.apply(this, args);
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2];
  const held = new Map();
  const record = data => appendFileSync(`${root}/model.jsonl`, JSON.stringify(data) + '\n');
  const server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/release/')) {
        const name = req.url.split('/').pop();
        if (!held.has(name)) { res.writeHead(409); res.end('not held'); return; }
        held.get(name)(); held.delete(name); res.end('released'); return;
      }
      if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (body.model !== 'offline') throw new Error(`Unexpected model ${body.model}`);
      record({ event: 'request', body });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'proof', object: 'chat.completion.chunk', created: 0, model: 'offline', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      const end = reason => { send({}, reason); res.end('data: [DONE]\n\n'); };
      send({ role: 'assistant' });
      // Children carry their task in a user message; parent has it only in tool arguments.
      const userText = body.messages.filter(m => m.role === 'user').map(m => JSON.stringify(m.content)).join('\n');
      const child = /CHILD_TASK_(alpha|beta)/.exec(userText)?.[1];
      if (child) {
        send({ content: `CHILD_${child}_LIVE streaming before release\n` });
        let tick = 0;
        const interval = setInterval(() => send({ content: `CHILD_${child}_TICK_${++tick}\n` }), 500);
        const timeout = setTimeout(() => { clearInterval(interval); end('stop'); record({ event: 'expired', child }); }, 90000);
        const finish = () => { clearInterval(interval); clearTimeout(timeout); send({ content: `CHILD_${child}_DONE` }); end('stop'); record({ event: 'released', child }); };
        res.on('close', () => { clearInterval(interval); clearTimeout(timeout); });
        held.set(child, finish); record({ event: 'held', child }); return;
      }
      const results = body.messages.filter(m => m.role === 'tool');
      if (!results.length) {
        send({ tool_calls: ['alpha', 'beta'].map((name, index) => ({ index, id: `spawn_${name}`, type: 'function', function: { name: 'subagent', arguments: JSON.stringify({ agent: 'scout', name, model: 'tmux-proof/offline', task: `CHILD_TASK_${name}: stream the synthetic marker, use no tools.` }) } })) });
        end('tool_calls');
      } else {
        record({ event: 'parent-results', results });
        send({ content: 'PARENT_RECEIVED_REAL_RESULTS' }); end('stop');
      }
    } catch (error) { record({ event: 'error', error: String(error) }); res.end(); }
  });
  server.listen(0, '127.0.0.1', () => writeFileSync(`${root}/port`, String(server.address().port)));
}

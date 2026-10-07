// Loopback OpenAI-compatible fixture; preloading also blocks non-loopback Node TCP.
import net from 'node:net';
import {createServer} from 'node:http';
import {appendFileSync, writeFileSync, readdirSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root = process.env.LIFECYCLE_LAB;
const record = (event, extra = {}) => appendFileSync(`${root}/events.jsonl`, JSON.stringify({time: Date.now(), actor: process.pid, event, ...extra}) + '\n');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const input = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof input[0] === 'object' ? input[0] : {port: input[0], host: typeof input[1] === 'string' ? input[1] : undefined};
  const host = options.host ?? options.hostname ?? 'localhost';
  if (!options.path && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    record('network-denied', {host});
    throw new Error('Lab permits only loopback TCP');
  }
  return connect.apply(this, args);
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hashes = new Map();
  // Observation timestamps, not claims about the exact filesystem write instant.
  setInterval(() => {
    for (const file of readdirSync(`${root}/histories`)) {
      if (!file.endsWith('.jsonl')) continue;
      const bytes = readFileSync(`${root}/histories/${file}`);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hashes.get(file) !== hash) { hashes.set(file, hash); record('history-observed', {file, hash, bytes: bytes.length}); }
    }
  }, 100).unref();
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    let raw = ''; for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw);
    record('request', {body});
    const user = body.messages.filter(m => m.role === 'user').at(-1);
    const input = typeof user?.content === 'string' ? user.content : (user?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
    const text = `LAB_REPLY ${input}`;
    const requestId = `${process.pid}-${Date.now()}`;
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({id:requestId,object:'chat.completion.chunk',created:0,model:'offline',choices:[{index:0,delta,finish_reason}]})}\n\n`);
    const finish = () => { send({}, 'stop'); res.end('data: [DONE]\n\n'); };
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    if (input.startsWith('slow ')) {
      record('stream-started', {requestId, input});
      send({role:'assistant', content:'LAB_STARTED accepted slow request\n'});
      let chunk = 0;
      let complete = false;
      const timer = setInterval(() => {
        chunk += 1;
        send({content:`LAB_CHUNK ${chunk}\n`});
        record('stream-chunk', {requestId, chunk});
        if (chunk === 15) {
          complete = true;
          clearInterval(timer);
          send({content:`LAB_DONE ${input.slice(5)}`});
          finish();
          record('stream-completed', {requestId, chunks:chunk});
          record('response', {requestId, text:`LAB_DONE ${input.slice(5)}`});
        }
      }, 1000);
      res.on('close', () => {
        clearInterval(timer);
        if (!complete) record('stream-aborted', {requestId, chunks:chunk});
      });
      return;
    }
    send({role:'assistant', content:text});
    finish(); record('response', {requestId, text});
  });
  server.listen(0, '127.0.0.1', () => writeFileSync(`${root}/port`, String(server.address().port)));
}

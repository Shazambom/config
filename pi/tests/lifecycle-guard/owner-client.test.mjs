import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Socket } from 'node:net';
async function withServer(reply, run) {
  const sockets = new Set();
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let raw = ''; socket.on('data', data => { raw += data; });
    socket.on('end', () => reply(socket, JSON.parse(raw)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(server.address().port); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}
const receipt = { pid: 123, started: 'fixture identity', generation: 'generation' };
const file = '/synthetic/session.jsonl';
for (const action of ['probe', 'stop']) test(`shared owner client sends ${action} and verifies exact identity`, async () => {
  const { ownerRequest } = await import('../../agent/lifecycle/owner-client.mjs');
  await withServer((socket, request) => {
    assert.deepEqual(request, { action, file, generation: receipt.generation });
    socket.end(JSON.stringify({ type: 'owner', file, ...receipt }));
  }, async port => { await ownerRequest({ ...receipt, port }, file, action, 1000); });
});
for (const deadline of [500, 1000]) test(`owner client preserves ${deadline}ms caller deadline`, async () => {
  const { ownerRequest } = await import('../../agent/lifecycle/owner-client.mjs');
  await withServer(() => {}, async port => {
    const start = performance.now();
    await assert.rejects(ownerRequest({ ...receipt, port }, file, 'probe', deadline));
    const elapsed = performance.now() - start;
    assert.ok(elapsed >= deadline - 50 && elapsed < deadline + 1000, `${elapsed}ms`);
  });
});
test('partial response bytes cannot extend the owner request wall-clock deadline', async () => {
  const { ownerRequest } = await import('../../agent/lifecycle/owner-client.mjs');
  let serverWrites = 0, clientBytes = 0, request;
  await withServer(socket => {
    const trickle = setInterval(() => { if (!socket.destroyed) { socket.write(' '); serverWrites++; } }, 10);
    socket.once('close', () => clearInterval(trickle));
  }, async port => {
    const emit = Socket.prototype.emit;
    Socket.prototype.emit = function(event, ...args) {
      if (event === 'data' && this.remotePort === port) clientBytes += args[0].length;
      return emit.call(this, event, ...args); // Observe real reads without replacing transport.
    };
    try {
      const start = performance.now();
      let settledAt, error;
      request = ownerRequest({ ...receipt, port }, file, 'probe', 40).catch(value => { error = value; }).finally(() => { settledAt = performance.now(); });
      await Promise.race([request, new Promise(resolve => setTimeout(resolve, 160))]);
      const observedMs = performance.now() - start;
      console.log(JSON.stringify({ deadlineMs: 40, observedMs, settledMs: settledAt === undefined ? null : settledAt - start, serverWrites, clientBytes }));
      assert.ok(serverWrites > 0 && clientBytes > 0, 'partial response must actually reach the client');
      assert.notEqual(settledAt, undefined, 'trickling response must not keep the request pending beyond its deadline');
      assert.ok(settledAt - start < 140, `actual settlement ${settledAt - start}ms`);
      assert.ok(error, 'incomplete response must reject');
    } finally { Socket.prototype.emit = emit; }
  }).finally(async () => { await request; });
});

for (const response of [{ type: 'refused' }, { type: 'owner', file, ...receipt, generation: 'other' }, { type: 'owner', file, ...receipt, pid: 124 }, { type: 'owner', file, ...receipt, started: 'other' }, { type: 'owner', file: 'other', ...receipt }, 'x'.repeat(8193)]) test(`owner client rejects nonmatching or oversized reply ${JSON.stringify(response).slice(0, 90)}`, async () => {
  const { ownerRequest } = await import('../../agent/lifecycle/owner-client.mjs');
  await withServer(socket => socket.end(typeof response === 'string' ? response : JSON.stringify(response)), async port => {
    await assert.rejects(ownerRequest({ ...receipt, port }, file, 'probe', 500));
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { createJiti } from 'jiti';
import { createEventBus } from '@earendil-works/pi-coding-agent';

async function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit'); child.kill('SIGKILL'); await done;
}
async function answer(child, message) {
  const response = once(child, 'message'); child.send(message); return (await response)[0];
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'pi-worker-owner-'));
  const children = [];
  const child = name => { const value = fork(new URL(name, import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.push(value); return value; };
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']); children.push(sentinel);
  try {
    const file = join(root, 'root.jsonl'); await writeFile(file, '{}\n');
    const owner = child('./owner-root.mjs');
    const owned = await answer(owner, { type: 'claim', file }); assert.equal(owned.type, 'owned');
    const directory = join(root, '.pi-lifecycle');
    const name = (await readdir(directory)).find(name => name.endsWith('.owner.json'));
    const metadata = join(directory, name);
    const record = JSON.parse(await readFile(metadata, 'utf8'));
    const receipt = { pid: owner.pid, started: record.started, sessionFile: await realpath(file), generation: record.generation };
    await run({ root, owner, receipt, metadata, child, sentinel });
    process.kill(sentinel.pid, 0);
  } finally { for (const process of children.reverse()) await kill(process); await rm(root, { recursive: true, force: true }); }
}

test('worker verification delegates exactly one fresh root identity query to its authoritative helper', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-identity-count-'));
  const previousPath = process.env.PATH;
  const realPs = execFileSync('which', ['ps'], { encoding: 'utf8' }).trim();
  const log = join(directory, 'queries');
  await writeFile(join(directory, 'ps'), `#!/bin/sh\nprintf '%s %s\\n' "$PPID" "$2" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realPs)} "$@"\n`, { mode: 0o700 });
  process.env.PATH = `${directory}:${previousPath}`;
  try {
    await fixture(async ({ receipt, child }) => {
      const before = (await readFile(log, 'utf8')).trim().split('\n').filter(line => line.split(' ')[1] === String(receipt.pid)).length;
      const worker = child('./owned-worker.mjs');
      const result = await answer(worker, { owningRoot: receipt });
      assert.equal(result.type, 'owned');
      const queries = (await readFile(log, 'utf8')).trim().split('\n').map(line => line.split(' '));
      assert.equal(queries.filter(([caller, target]) => caller === String(result.helperPid) && target === String(receipt.pid)).length, 0, 'worker must not duplicate the authoritative helper root ps');
      assert.equal(queries.filter(([, target]) => target === String(receipt.pid)).length - before, 1, 'the responding owner helper still queries fresh exact root identity');
    });
  } finally { process.env.PATH = previousPath; await rm(directory, { recursive: true, force: true }); }
});

for (const persisted of [false, true]) test(`original root SIGKILL retires hung ${persisted ? 'persisted' : 'stateless'} worker within five seconds, not sentinel`, async () => fixture(async ({ root, owner, receipt, child, sentinel }) => {
  const worker = child('./owned-worker.mjs');
  const file = persisted ? join(root, 'worker.jsonl') : undefined;
  if (file) await writeFile(file, '{}\n');
  const result = await answer(worker, { owningRoot: receipt, file, hang: true });
  assert.equal(result.type, 'owned');
  assert.equal(result.sessionFile, persisted ? await realpath(file) : receipt.sessionFile);
  if (persisted) assert.notEqual(result.generation, receipt.generation);
  else assert.equal(result.generation, receipt.generation);
  const exited = once(worker, 'exit');
  await kill(owner);
  const start = performance.now();
  let timer;
  try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('worker survived five seconds after root exit')), 5000); })]); }
  finally { clearTimeout(timer); }
  const elapsed = performance.now() - start;
  assert.ok(elapsed <= 5000, `actual root-exit to worker-exit ${elapsed}ms`);
  console.log(`root-exit→${persisted ? 'persisted' : 'stateless'}-worker-exit ${elapsed.toFixed(1)}ms`);
  process.kill(sentinel.pid, 0);
}));

test('admitted actual CLI worker exits within five seconds of root death during a trickling owner probe', async () => fixture(async ({ root, owner, receipt, metadata, sentinel }) => {
  const sockets = new Set(), timers = new Set();
  let serverWrites = 0, worker;
  const endpoint = createSocketServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('error', () => {});
    let raw = ''; socket.on('data', bytes => { raw += bytes; });
    socket.on('end', () => {
      assert.deepEqual(JSON.parse(raw), { action: 'probe', file: receipt.sessionFile, generation: receipt.generation });
      const timer = setInterval(() => { if (!socket.destroyed) { socket.write(' '); serverWrites++; } }, 10);
      timers.add(timer);
      socket.once('close', () => { clearInterval(timer); timers.delete(timer); sockets.delete(socket); });
    });
  });
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  try {
    const agent = join(root, 'trickle-agent'); await mkdir(agent);
    const reads = join(root, 'client-reads.jsonl'), observer = join(root, 'observe-socket.mjs');
    await writeFile(reads, '');
    await writeFile(observer, `import {Socket} from 'node:net'; import {appendFileSync} from 'node:fs';
      const emit=Socket.prototype.emit;
      Socket.prototype.emit=function(event,...args){
        if(event==='data' && this.remotePort===${endpoint.address().port}) appendFileSync(${JSON.stringify(reads)},JSON.stringify({pid:process.pid,bytes:args[0].length})+'\\n');
        return emit.call(this,event,...args);
      };`);
    const cli = execFileSync('bash', ['-c', 'source "$1"; pi_real_command "$(command -v pi)"', 'trickle-worker-test', fileURLToPath(new URL('../../command-path.sh', import.meta.url))], { encoding: 'utf8' }).trim();
    worker = spawn(process.execPath, [cli, '--mode', 'rpc', '--no-session', '--no-extensions', '--no-mcp', '--no-context-files', '--no-skills', '--no-prompt-templates',
      '--extension', fileURLToPath(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url)),
      '--extension', fileURLToPath(new URL('./worker-startup-probe.ts', import.meta.url))], {
      cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_LIFECYCLE_OWNER: JSON.stringify(receipt), TMUX: '', TMUX_PANE: '', NODE_OPTIONS: `--import=${pathToFileURL(observer).href}` },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const exited = once(worker, 'exit');
    let stderr = ''; worker.stderr.on('data', bytes => { stderr += bytes; });
    let startup;
    for (let i = 0; i < 200; i++) {
      try { startup = JSON.parse(await readFile(join(agent, 'worker-startup.json'), 'utf8')); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(startup?.admission.status, 'owned', stderr);
    assert.equal(startup.admission.generation, receipt.generation);
    worker.kill('SIGSTOP'); // Force detached-helper enforcement, not cooperative worker exit.
    const record = JSON.parse(await readFile(metadata, 'utf8'));
    await writeFile(metadata, JSON.stringify({ ...record, port: endpoint.address().port }));
    let observed = [];
    for (let i = 0; i < 100; i++) {
      const text = (await readFile(reads, 'utf8')).trim();
      if (text) { observed = text.split('\n').map(line => JSON.parse(line)); break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(observed.some(row => row.pid !== worker.pid && row.bytes > 0), 'detached helper must actually receive partial response bytes before root death');
    assert.equal(worker.exitCode, null);
    await kill(owner);
    const rootExitedAt = performance.now();
    let timer, exitAt;
    try { exitAt = await Promise.race([exited.then(() => performance.now()), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('admitted worker survived root exit during partial response')), 5000); })]); }
    catch (error) {
      observed = (await readFile(reads, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      console.log(JSON.stringify({ rootExitToObservationMs: performance.now() - rootExitedAt, workerExited: worker.exitCode !== null || worker.signalCode !== null, serverWrites, clientBytes: observed.reduce((sum, row) => sum + row.bytes, 0) }));
      throw error;
    }
    finally { clearTimeout(timer); }
    observed = (await readFile(reads, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    console.log(JSON.stringify({ rootExitToWorkerExitMs: exitAt - rootExitedAt, serverWrites, clientBytes: observed.reduce((sum, row) => sum + row.bytes, 0) }));
    assert.ok(exitAt - rootExitedAt <= 5000);
    process.kill(sentinel.pid, 0);
  } finally {
    for (const timer of timers) clearInterval(timer);
    for (const socket of sockets) socket.destroy();
    if (worker) await kill(worker);
    await new Promise(resolve => endpoint.close(resolve));
  }
}));

for (const problem of ['dead', 'identity-changed', 'generation-changed', 'malformed']) test(`worker refuses initial work for ${problem} owner without signalling foreign processes`, async () => fixture(async ({ owner, receipt, child, sentinel }) => {
  if (problem === 'dead') await kill(owner);
  if (problem === 'identity-changed') receipt.started = 'not the original root';
  if (problem === 'generation-changed') receipt.generation = 'replacement-generation';
  const worker = child('./owned-worker.mjs');
  const exited = once(worker, 'exit');
  const result = await answer(worker, { owningRoot: problem === 'malformed' ? { pid: sentinel.pid } : receipt });
  assert.equal(result.type, 'stop');
  await exited;
  if (problem !== 'dead') process.kill(owner.pid, 0);
  process.kill(sentinel.pid, 0);
}));

for (const persisted of [false, true]) test(`extension gates ${persisted ? 'persisted' : 'stateless'} worker through original-root monitor`, async () => fixture(async ({ root, owner, receipt }) => {
  const previousOwner = process.env.PI_LIFECYCLE_OWNER;
  const previousAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_LIFECYCLE_OWNER = JSON.stringify(receipt);
  process.env.PI_CODING_AGENT_DIR = root;
  const handlers = {};
  let shutdowns = 0, helper;
  const file = persisted ? join(root, 'worker.jsonl') : undefined;
  if (file) await writeFile(file, '{}\n');
  const ctx = { hasUI: false, sessionManager: { getSessionFile: () => file }, abort() {}, shutdown() {
    shutdowns++;
    if (helper?.connected) helper.send({ type: 'release' });
  } };
  const pi = { events: createEventBus(), on: (name, handler) => handlers[name] = handler, registerCommand() {}, sendUserMessage() {} };
  try {
    const jiti = createJiti(import.meta.url);
    (await jiti.import(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url).href)).default(pi);
    await handlers.session_start({ reason: 'startup' }, ctx);
    helper = globalThis[Symbol.for('portable-pi.session-lifecycle')]?.child;
    helper?.ref();
    let admission; pi.events.emit('session-lifecycle:admission', { respond: value => admission = value });
    assert.equal(admission.status, 'owned');
    assert.equal(admission.sessionFile, persisted ? await realpath(file) : receipt.sessionFile);
    assert.equal((await readdir(join(root, '.pi-lifecycle'))).filter(name => name.endsWith('.sqlite')).length, persisted ? 2 : 1, 'stateless worker must not create a saved-session lease');
    await kill(owner);
    for (let i = 0; i < 100 && !shutdowns; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(shutdowns, 1);
    assert.equal((await handlers.input({}, ctx))?.action, 'handled');
  } finally {
    if (helper?.connected) { const exited = once(helper, 'exit'); helper.send({ type: 'release' }); await exited; }
    delete globalThis[Symbol.for('portable-pi.session-lifecycle')];
    if (previousOwner === undefined) delete process.env.PI_LIFECYCLE_OWNER; else process.env.PI_LIFECYCLE_OWNER = previousOwner;
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
  }
}));

for (const scenario of ['live', 'dead', 'conflict']) test(`installed CLI worker startup ${scenario}`, async () => fixture(async ({ root, owner, receipt, child }) => {
  const ownerAlive = scenario !== 'dead';
  const file = scenario === 'conflict' ? join(root, 'worker.jsonl') : undefined;
  if (file) {
    await writeFile(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: root }) + '\n');
    const holder = child('./owned-worker.mjs');
    assert.equal((await answer(holder, { file, owningRoot: receipt })).type, 'owned');
  }
  const cli = execFileSync('bash', ['-c', 'source "$1"; pi_real_command "$(command -v pi)"', 'worker-owner-test', fileURLToPath(new URL('../../command-path.sh', import.meta.url))], { encoding: 'utf8' }).trim();
  const agent = join(root, 'agent'); await mkdir(agent);
  if (!ownerAlive) await kill(owner);
  const worker = spawn(process.execPath, [cli, '--mode', 'rpc', ...(file ? ['--session', file] : ['--no-session']), '--no-extensions', '--no-mcp', '--no-context-files', '--no-skills', '--no-prompt-templates',
    '--extension', fileURLToPath(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url)),
    '--extension', fileURLToPath(new URL('./worker-startup-probe.ts', import.meta.url))], {
    cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_LIFECYCLE_OWNER: JSON.stringify(receipt), TMUX: '', TMUX_PANE: '' },
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  const exited = once(worker, 'exit');
  let stderr = ''; worker.stderr.on('data', data => { stderr += data; });
  try {
    let startup;
    for (let i = 0; i < 400; i++) {
      try { startup = JSON.parse(await readFile(join(agent, 'worker-startup.json'), 'utf8')); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(startup, `actual CLI startup was not observed: ${stderr}`);
    assert.equal(startup.sessionFile, file);
    assert.equal(startup.admission.status, scenario === 'live' ? 'owned' : 'stopping');
    assert.equal(startup.initialized, scenario === 'live');
    assert.equal((await readdir(join(root, '.pi-lifecycle'))).filter(name => name.endsWith('.sqlite')).length, file ? 2 : 1);
    if (ownerAlive) await kill(owner);
    const start = performance.now();
    let timer;
    try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CLI worker remained after owner exit')), 5000); })]); }
    finally { clearTimeout(timer); }
    assert.ok(performance.now() - start <= 5000);
  } finally { await kill(worker); }
}));

for (const managed of [true, false]) test(`installed CLI ${managed ? 'managed resume' : 'ordinary root recovery'} replays supplied startup text and image once after fresh admission`, async () => fixture(async ({ root, receipt, child }) => {
  const cli = execFileSync('bash', ['-c', 'source "$1"; pi_real_command "$(command -v pi)"', 'worker-owner-test', fileURLToPath(new URL('../../command-path.sh', import.meta.url))], { encoding: 'utf8' }).trim();
  const file = join(root, 'worker.jsonl');
  await writeFile(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: root }) + '\n');
  const oldWorker = child('./owned-worker.mjs');
  assert.equal((await answer(oldWorker, { file, owningRoot: receipt })).type, 'owned');
  if (managed) oldWorker.kill('SIGSTOP');
  else await kill(oldWorker);
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'STARTUP_REPLAY_OK' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let worker;
  try {
    const agent = join(root, 'resume-agent'); await mkdir(agent);
    await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { lifecycle: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'synthetic-only', models: [{ id: 'offline', input: ['text', 'image'], contextWindow: 128000, maxTokens: 1024 }] } } }));
    const task = join(root, 'task.txt'); await writeFile(task, 'RESUME_LIVE supplied task\nKeep this exact second line.');
    const observer = join(root, 'input-observer.ts');
    await writeFile(observer, `import {appendFileSync} from 'node:fs'; export default function(pi) { pi.on('input', event => { appendFileSync(${JSON.stringify(join(agent, 'inputs.jsonl'))}, JSON.stringify({source:event.source,text:event.text,images:event.images})+'\\n'); }); }`);
    const image = join(root, 'image.png'); await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const env = { ...process.env, PI_CODING_AGENT_DIR: agent, TMUX: '', TMUX_PANE: '' };
    if (managed) env.PI_LIFECYCLE_OWNER = JSON.stringify(receipt); else delete env.PI_LIFECYCLE_OWNER;
    worker = spawn(process.execPath, [cli, '--print', '--mode', 'json', '--provider', 'lifecycle', '--model', 'offline', '--session', file,
      '--no-extensions', '--no-mcp', '--no-context-files', '--no-skills', '--no-prompt-templates',
      '--extension', observer,
      '--extension', fileURLToPath(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url)),
      '--extension', fileURLToPath(new URL('./worker-startup-probe.ts', import.meta.url)), `@${task}`, `@${image}`], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; worker.stdout.on('data', bytes => { output += bytes; }); worker.stderr.on('data', bytes => { output += bytes; });
    if (managed) {
      await new Promise(resolve => setTimeout(resolve, 800));
      assert.equal(requests.length, 0, 'no model work while previous worker still owns its saved session');
      await kill(oldWorker);
    }
    for (let i = 0; i < 300 && !output.includes('STARTUP_REPLAY_OK'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    const inputs = await readFile(join(agent, 'inputs.jsonl'), 'utf8').catch(() => 'no input events');
    const startupTrace = await readFile(join(agent, 'worker-startup.json'), 'utf8').catch(() => 'no startup');
    assert.equal(requests.length, 1, `supplied startup task must survive fresh replacement exactly once: ${output}\n${inputs}\n${startupTrace}`);
    const inputEvents = inputs.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(inputEvents.map(event => event.source), ['interactive', 'extension']);
    assert.equal(inputEvents[1].text, inputEvents[0].text);
    assert.deepEqual(inputEvents[1].images, inputEvents[0].images);
    const users = requests[0].messages.filter(message => message.role === 'user');
    const supplied = JSON.stringify(users);
    assert.ok(supplied.includes('RESUME_LIVE supplied task\\nKeep this exact second line.'));
    assert.ok(supplied.includes('image_url'), 'startup image must accompany replayed text');
    const startup = JSON.parse(await readFile(join(agent, 'worker-startup.json'), 'utf8'));
    assert.equal(startup.admission.status, 'owned');
    assert.ok(output.includes('STARTUP_REPLAY_OK'));
  } finally {
    if (worker) await kill(worker);
    await new Promise(resolve => server.close(resolve));
  }
}));

test('successor worker waits for stopped old worker retirement and acquires the same lease without a menu', async () => fixture(async ({ root, owner, receipt, child }) => {
  const file = join(root, 'worker.jsonl'); await writeFile(file, '{}\n');
  const oldWorker = child('./owned-worker.mjs');
  const first = await answer(oldWorker, { file, owningRoot: receipt });
  assert.equal(first.type, 'owned');
  oldWorker.kill('SIGSTOP');
  const nextRootFile = join(root, 'next-root.jsonl'); await writeFile(nextRootFile, '{}\n');
  const nextRoot = child('./owner-root.mjs');
  const next = await answer(nextRoot, { type: 'claim', file: nextRootFile });
  assert.equal(next.type, 'owned');
  const { inspectOwner } = await import('../../agent/lifecycle/lease.mjs');
  const evidence = inspectOwner(nextRootFile);
  const nextReceipt = { pid: nextRoot.pid, started: evidence.owner.started, sessionFile: evidence.sessionFile, generation: next.generation };
  const successor = child('./owned-worker.mjs');
  const admitted = answer(successor, { file, owningRoot: nextReceipt });
  // Begin the contender while the old root is still live; no ownership bypass.
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(inspectOwner(file).owner.generation, first.generation);
  const retired = once(oldWorker, 'exit');
  await kill(owner);
  const start = performance.now();
  const result = await admitted;
  assert.equal(result.type, 'owned');
  await retired;
  assert.ok(performance.now() - start < 5000);
  assert.equal(result.recovered, true, 'successor must refresh the saved file before admitting stale loaded history');
  assert.notEqual(result.generation, first.generation);
  process.kill(nextRoot.pid, 0);
}));

test('persisted worker retains independent duplicate-session protection', async () => fixture(async ({ root, receipt, child }) => {
  const file = join(root, 'worker.jsonl'); await writeFile(file, '{}\n');
  const first = child('./owned-worker.mjs');
  assert.equal((await answer(first, { file, owningRoot: receipt })).type, 'owned');
  const duplicate = child('./owned-worker.mjs');
  const start = performance.now();
  assert.equal((await answer(duplicate, { file, owningRoot: receipt })).type, 'conflict');
  assert.ok(performance.now() - start >= 4900, 'managed conflict should wait for bounded retirement');
  assert.ok(performance.now() - start < 6500, 'known live owner remains blocked after the wait bound');
}));

for (const change of ['generation', 'identity', 'unreachable', 'malformed']) test(`worker stops on ${change} evidence while original root remains alive`, async () => fixture(async ({ receipt, metadata, owner, child }) => {
  const worker = child('./owned-worker.mjs');
  assert.equal((await answer(worker, { owningRoot: receipt })).type, 'owned');
  const exited = once(worker, 'exit');
  const record = JSON.parse(await readFile(metadata, 'utf8'));
  const changed = change === 'generation' ? { ...record, generation: 'replacement-generation' } :
    change === 'identity' ? { ...record, started: 'different incarnation' } :
    change === 'unreachable' ? { ...record, port: 1 } : null;
  await writeFile(metadata, JSON.stringify(changed));
  let timer;
  try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('worker followed changed generation')), 5000); })]); }
  finally { clearTimeout(timer); }
  process.kill(owner.pid, 0);
}));

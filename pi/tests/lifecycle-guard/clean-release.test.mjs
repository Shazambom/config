import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { once, EventEmitter } from 'node:events';
import { inspectOwner } from '../../agent/lifecycle/lease.mjs';

function deadline(promise, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 8000); })]).finally(() => clearTimeout(timer));
}
function eventMatching(emitter, event, match) {
  return new Promise(resolve => {
    const listener = value => { if (match(value)) { emitter.off(event, listener); resolve(value); } };
    emitter.on(event, listener);
  });
}

test('actual CLI refreshes clean released ownership after loading stale history, preserving supplied text/images exactly once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-clean-release-'));
  const processes = [], requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw); requests.push(body);
    const response = JSON.stringify(body.messages.at(-1)).includes('A_LATE_TURN') ? 'A_LATE_REPLY' : 'B_STARTUP_REPLY';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const base = { id: 'fixture', object: 'chat.completion.chunk', model: 'offline' };
    res.end(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: response }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const cli = execFileSync('bash', ['-c', 'source "$1"; pi_real_command "$(command -v pi)"', 'clean-release-test', fileURLToPath(new URL('../../command-path.sh', import.meta.url))], { encoding: 'utf8' }).trim();
    const file = join(root, 'saved.jsonl'), other = join(root, 'other.jsonl');
    const header = () => ({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: root });
    const seed = { type: 'message', id: randomUUID(), parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'SEED_HISTORY' }], timestamp: Date.now() } };
    await writeFile(file, JSON.stringify(header()) + '\n' + JSON.stringify(seed) + '\n');
    await writeFile(other, JSON.stringify(header()) + '\n');
    const guard = fileURLToPath(new URL('../../agent/lifecycle/session-lifecycle.ts', import.meta.url));
    async function launch(name, args, extensions = [guard]) {
      const agent = join(root, name); await mkdir(agent);
      await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { lifecycle: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'synthetic-only', models: [{ id: 'offline', input: ['text', 'image'], contextWindow: 128000, maxTokens: 1024 }] } } }));
      const env = { ...process.env, PI_CODING_AGENT_DIR: agent, TMUX: '', TMUX_PANE: '' }; delete env.PI_LIFECYCLE_OWNER;
      const child = spawn(process.execPath, [cli, '--provider', 'lifecycle', '--model', 'offline', '--session', file, '--no-extensions', '--no-mcp', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-tools', ...extensions.flatMap(path => ['--extension', path]), ...args], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
      processes.push(child);
      child.output = ''; child.stdout.on('data', bytes => { child.output += bytes; }); child.stderr.on('data', bytes => { child.output += bytes; });
      return child;
    }
    const a = await launch('a', ['--mode', 'rpc']);
    const events = new EventEmitter();
    createInterface({ input: a.stdout }).on('line', line => { try { events.emit('event', JSON.parse(line)); } catch {} });
    async function rpc(command) {
      const id = randomUUID();
      const answer = eventMatching(events, 'event', value => value.type === 'response' && value.id === id);
      a.stdin.write(JSON.stringify({ ...command, id }) + '\n');
      const result = await deadline(answer, `RPC ${command.type} failed: ${a.output}`);
      assert.equal(result.success, true, JSON.stringify(result));
      return result;
    }
    await rpc({ type: 'get_state' });
    assert.equal(inspectOwner(file).owner.pid, a.pid);
    const gate = join(root, 'before-claim.ts');
    await writeFile(gate, `export default function(pi) { pi.on('session_start', async (event,ctx) => {
      if(event.reason !== 'startup') return;
      const permit=new Promise(resolve=>process.once('message',resolve));
      process.send({type:'history-loaded',branch:ctx.sessionManager.getBranch()});
      await permit;
    }); }`);
    const task = join(root, 'task.txt'), image = join(root, 'image.png');
    await writeFile(task, 'B_SUPPLIED_TASK\nExact second line.');
    const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await writeFile(image, Buffer.from(imageData, 'base64'));
    const b = await launch('b', ['--print', `@${task}`, `@${image}`], [gate, guard]);
    const bExited = once(b, 'exit');
    const loading = eventMatching(b, 'message', value => value.type === 'history-loaded');
    b.stdin.end();
    const loaded = await deadline(loading, 'B did not load history');
    assert.ok(JSON.stringify(loaded.branch).includes('SEED_HISTORY'));
    assert.ok(!JSON.stringify(loaded.branch).includes('A_LATE_TURN'));
    assert.equal(requests.length, 0, 'B cannot work before its first ownership claim');
    const lateReply = eventMatching(events, 'event', value => value.type === 'agent_settled');
    await rpc({ type: 'prompt', message: 'A_LATE_TURN' });
    await deadline(lateReply, 'A late turn did not settle');
    const entriesAfterLate = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const late = entriesAfterLate.find(entry => entry.message?.role === 'assistant' && JSON.stringify(entry.message.content).includes('A_LATE_REPLY'));
    assert.ok(late);
    await rpc({ type: 'switch_session', sessionPath: other });
    process.kill(a.pid, 0);
    assert.equal(inspectOwner(file).owner.status, 'released');
    assert.equal(inspectOwner(file).owner.pid, a.pid, 'prior PID remains alive after clean release');
    assert.equal(requests.length, 1);
    b.send({ type: 'allow-first-claim' });
    const [code] = await deadline(bExited, 'B did not finish its supplied task');
    assert.equal(code, 0, b.output);
    assert.equal(requests.length, 2, 'A late turn and exactly one B task request');
    const context = JSON.stringify(requests[1].messages);
    assert.ok(context.includes('A_LATE_TURN') && context.includes('A_LATE_REPLY'), 'B provider context must contain the late turn written after B loaded history');
    assert.ok(context.includes('B_SUPPLIED_TASK\\nExact second line.'));
    assert.ok(context.includes(`data:image/png;base64,${imageData}`));
    const finalEntries = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const supplied = finalEntries.filter(entry => entry.message?.role === 'user' && JSON.stringify(entry.message.content).includes('B_SUPPLIED_TASK'));
    assert.equal(supplied.length, 1);
    const byId = new Map(finalEntries.map(entry => [entry.id, entry]));
    const ancestors = [];
    for (let cursor = supplied[0].parentId; cursor; cursor = byId.get(cursor)?.parentId) ancestors.push(cursor);
    assert.ok(ancestors.includes(late.id), 'saved B task parent chain must include the late assistant turn');
    process.kill(a.pid, 0);
  } finally {
    for (const child of processes.reverse()) if (child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await deadline(done, 'fixture process cleanup hung'); }
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

// Controlled root faults use only the private lab's inventoried PID, verified immediately before SIGKILL.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync, mkdirSync, readlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const evidence = resolve(process.argv[2]); mkdirSync(evidence, { recursive: true, mode: 0o700 });
const candidate = resolve(process.argv[3] ?? join(repo, 'pi/agent/wakeups/index.ts'));
const fault = process.argv[4] ?? 'kill'; assert.ok(['kill', 'quit'].includes(fault));
const contract = JSON.parse(readFileSync(join(repo, 'pi/tests/wakeups-sandbox/interface-v1.json')));
const run = (...args) => execFileSync('bash', [join(repo, 'pi/tests/lifecycle-lab/lab.sh'), ...args], { encoding: 'utf8', timeout: 60000 });
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const lines = p => existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const mono = () => Number(process.hrtime.bigint()) / 1e6;
const record = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
const text = m => typeof m.content === 'string' ? m.content : (m.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
const ps = (...args) => execFileSync('ps', args, { encoding: 'utf8' }).trimEnd();
const cwd = pid => existsSync(`/proc/${pid}/cwd`) ? readlinkSync(`/proc/${pid}/cwd`) : execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).split('\n').find(s => s.startsWith('n'))?.slice(1);
function live(pid) {
  try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return false; throw e; }
  try { return !ps('-p', String(pid), '-o', 'stat=').includes('Z'); }
  catch (e) { try { process.kill(pid, 0); } catch (p) { if (p.code === 'ESRCH') return false; } throw e; }
}
function groupMembers(pgid) {
  return ps('-e', '-o', 'pid=', '-o', 'pgid=', '-o', 'stat=', '-o', 'command=').split('\n').map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return m && { pid: Number(m[1]), pgid: Number(m[2]), stat: m[3], command: m[4] };
  }).filter(p => p && p.pgid === pgid && !p.stat.includes('Z'));
}
let id, work, failure; const requests = [];
const observations = () => lines(join(work, 'wake-observations.jsonl'));
const server = createServer(async (req, res) => {
  if (req.url === '/health') { res.end('alive'); return; }
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push({ mono: mono(), body }); appendFileSync(join(evidence, 'provider.jsonl'), JSON.stringify(requests.at(-1)) + '\n');
    const first = requests.length === 1;
    const delta = first ? { role: 'assistant', tool_calls: [{ index: 0, id: 'owned-work', type: 'function', function: { name: 'watch_shell', arguments: JSON.stringify({ command: `exec bash ${quote(join(work, 'foreground.sh'))}`, on_exit: 'Report the actual owned foreground command outcome' }) } }] } : { role: 'assistant', content: 'OWNED_RUNNING' };
    const base = { id: `owned-${requests.length}`, object: 'chat.completion.chunk', created: 0, model: 'offline' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [d, finish_reason] of [[delta, null], [{}, first ? 'tool_calls' : 'stop']]) res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: d, finish_reason }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (e) { failure ??= e; res.destroy(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const until = async (predicate, ms, label) => {
  const end = mono() + ms;
  while (!predicate() && !failure && mono() < end) await pause(50);
  if (failure) throw failure;
  assert.ok(predicate(), label);
};
try {
  const installed = JSON.parse(run('resolve')); record('installed-cli.json', installed); record('case.json', { candidate, fault });
  const wrapper = join(evidence, 'candidate.mjs');
  writeFileSync(wrapper, `process.argv = process.argv.flatMap(a => a === '--no-tools' ? ['--no-builtin-tools', '--tools', ${JSON.stringify(contract.tools.map(t => t.name).join(','))}] : [a]);\nawait import(${JSON.stringify(pathToFileURL(installed.cli).href)});\n`); chmodSync(wrapper, 0o700);
  const created = JSON.parse(run('create', '--cli', wrapper, '--extension', join(repo, 'pi/agent/lifecycle/session-lifecycle.ts'), '--extension', join(repo, 'pi/tests/wakeups-runtime/observe.ts'), '--extension', candidate));
  ({ id, evidence: work } = created); record('lab.json', created);
  writeFileSync(join(work, 'foreground.sh'), `printf '%s\\n' \"$$\" > ${quote(join(work, 'foreground.pid'))}\nsleep 60 &\nchild=$!\nprintf '%s\\n' \"$child\" > ${quote(join(work, 'descendant.pid'))}\nwait \"$child\"\n`, { mode: 0o700 });
  const modelsPath = join(work, 'agent/models.json'); const models = json(modelsPath);
  models.providers.lifecycle.baseUrl = `http://127.0.0.1:${server.address().port}/v1`; writeFileSync(modelsPath, JSON.stringify(models)); assert.deepEqual(json(join(work, 'agent/auth.json')), {});
  run('attach', id, 'terminal'); run('open', id, 'wake');
  await until(() => observations().some(o => o.event.type === 'session_start'), 15000, 'CLI startup');
  assert.ok(observations().some(o => o.admission?.status === 'owned'), 'genuine guard ownership');
  run('type', id, 'wake', 'Launch the private ordinary foreground job'); run('key', id, 'wake', 'Enter');
  await until(() => requests.length === 2 && observations().at(-1).event.type === 'agent_settled', 15000, 'actual tool roundtrip settles');
  const receipt = observations().find(o => o.event.type === 'message_end' && o.event.message.toolCallId === 'owned-work')?.event.message;
  assert.ok(receipt && !receipt.isError, 'real shell receipt'); assert.equal(JSON.parse(text(receipt)).status, 'running');
  await until(() => existsSync(join(work, 'foreground.pid')) && existsSync(join(work, 'descendant.pid')), 5000, 'fixture process IDs');
  const foreground = Number(readFileSync(join(work, 'foreground.pid'), 'utf8')), descendant = Number(readFileSync(join(work, 'descendant.pid'), 'utf8'));
  for (const pid of [foreground, descendant]) assert.ok(Number.isInteger(pid) && pid > 1 && live(pid), 'fixture process is actually live');
  const pgid = Number(ps('-p', String(foreground), '-o', 'pgid=').trim());
  assert.equal(Number(ps('-p', String(descendant), '-o', 'pgid=').trim()), pgid, 'ordinary descendant belongs to owned group');
  record('owned-before.json', { foreground, descendant, pgid, members: groupMembers(pgid) });
  const actor = json(join(work, 'actors/pi-wake.json')), sentinel = json(join(work, 'actors/provider.json'));
  const status = JSON.parse(run('status', id)); record('before-fault-status.json', status);
  assert.ok(status.conversations.wake.alive && live(sentinel.pid), 'root and unrelated lab provider live');
  assert.equal(ps('-p', String(sentinel.pid), '-o', 'lstart=', '-o', 'command='), sentinel.identity, 'sentinel identity verified');
  const identity = ps('-p', String(actor.pid), '-o', 'lstart=', '-o', 'command='), currentCwd = cwd(actor.pid);
  assert.ok(actor.pid > 1 && actor.cwd.startsWith(join(work, 'instances') + '/'));
  assert.equal(identity.slice(0, 24), actor.start.slice(0, 24), 'inventoried root start identity');
  assert.ok(currentCwd === actor.cwd || currentCwd === '/private' + actor.cwd, 'inventoried root unique cwd');
  record('immediate-root-identity.json', { pid: actor.pid, identity, cwd: currentCwd, mono: mono() });
  if (fault === 'kill') process.kill(actor.pid, 'SIGKILL');
  else { run('type', id, 'wake', '/quit'); run('key', id, 'wake', 'Enter'); }
  await until(() => !live(actor.pid), 8000, 'actual root termination');
  await until(() => !live(foreground) && !live(descendant) && groupMembers(pgid).length === 0, 8000, 'product stops ordinary owned foreground group before lab cleanup');
  assert.ok(live(sentinel.pid), 'unrelated provider survives product cleanup');
  assert.equal(ps('-p', String(sentinel.pid), '-o', 'lstart=', '-o', 'command='), sentinel.identity, 'same unrelated sentinel survived');
  assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).text(), 'alive');
  record('product-cleanup-proof.json', { rootAlive: live(actor.pid), foregroundAlive: live(foreground), descendantAlive: live(descendant), groupMembers: groupMembers(pgid), sentinelAlive: live(sentinel.pid), beforeFixtureCleanup: true });
  assert.equal(requests.length, 2, 'no fabricated terminal-status model turn after root termination');
  record('result.json', { pass: true, fault, scope: 'ordinary same-group foreground work; no daemon/new-group escape guarantee' });
} catch (e) { failure = e; record('result.json', { pass: false, assertion: e.message, stack: e.stack }); }
finally {
  await new Promise(r => server.close(r));
  if (id) { try { record('observations.json', observations()); record('cleanup.json', JSON.parse(run('cleanup', id))); record('after-cleanup.json', JSON.parse(run('status', id))); } catch (e) { failure ??= e; record('cleanup-error.json', { error: e.message }); } }
}
console.log(`Evidence: ${evidence}\nLab: ${work ?? 'not created'}`);
if (failure) { console.error(failure.message); process.exitCode = 1; }

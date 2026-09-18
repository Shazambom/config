import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const source = process.argv[2];
const work = process.argv[3];
const exec = promisify(execFile);
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
const script = fileURLToPath(import.meta.url);
if (!work) {
  const temp = mkdtempSync(join(tmpdir(), 'pi-team-active-cli-'));
  const socket = join(temp, 'tmux.sock');
  const log = join(temp, 'driver.log');
  const status = join(temp, 'status');
  try {
    execFileSync('tmux', ['-S', socket, '-f', '/dev/null', 'new-session', '-d', '-x', '180', '-y', '60', '-s', 'fixture', `${quote(process.execPath)} ${quote(script)} ${quote(source)} ${quote(temp)} > ${quote(log)} 2>&1; echo $? > ${quote(status)}; tmux -S ${quote(socket)} wait-for -S finished; exec sleep 30`]);
    await exec('tmux', ['-S', socket, 'wait-for', 'finished'], { timeout: 30000 });
    process.stdout.write(readFileSync(log, 'utf8'));
    assert.equal(readFileSync(status, 'utf8').trim(), '0');
  } catch (error) {
    if (existsSync(log)) process.stderr.write(readFileSync(log, 'utf8'));
    throw error;
  } finally {
    try { execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' }); } catch {}
    rmSync(temp, { recursive: true, force: true });
  }
} else {
  const jiti = createJiti(import.meta.url);
  const { TeamStore } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
  const store = TeamStore.create(join(work, 'team'));
  for (const [id, name] of [['root', 'orchestrator'], ['peer', 'peer'], ['child', 'finishing-child']]) await store.register({ id, name, parent: id === 'root' ? null : 'root', live: true });
  await store.setDesired(true);
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); requests.push(payload);
    const marker = JSON.stringify(payload.messages).includes('ACCEPTED_AT_FINAL_BOUNDARY');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const base = { id: `fixture-${requests.length}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fixture' };
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: marker ? 'RACE_MARKER_OBSERVED' : 'INITIAL_FINAL' }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const agentDir = join(work, 'agent'); mkdirSync(agentDir);
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions', apiKey: 'synthetic-local-only', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'fixture', input: ['text'], contextWindow: 100000, maxTokens: 1000 }] } } }));
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', retry: { enabled: false }, compaction: { enabled: false } }));
  const auditPath = join(work, 'last-boundary.ts');
  // Registered before subagent-done: the send commits in the same event turn,
  // before the interval can run and before the production auto-exit check.
  writeFileSync(auditPath, `import { TeamStore } from ${JSON.stringify(join(source, 'pi-extension/subagents/team.ts'))};\nexport default function(pi) { let once = false; pi.on('agent_end', async () => { if (once) return; once = true; await new TeamStore(${JSON.stringify(store.dir)}).send('peer', {to:'finishing-child', message:'ACCEPTED_AT_FINAL_BOUNDARY'}); }); }\n`);
  const sessionFile = join(work, 'child.jsonl');
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'cli.js');
  const exitFile = join(work, 'child-status');
  const command = `cd ${quote(work)} && PI_CODING_AGENT_DIR=${quote(agentDir)} PI_SUBAGENT_AUTO_EXIT=1 PI_SUBAGENT_SESSION=${quote(sessionFile)} PI_TEAM_DIR=${quote(store.dir)} PI_TEAM_MEMBER=child ${quote(process.execPath)} ${quote(cli)} --session ${quote(sessionFile)} --no-extensions --tools read,team_send -e ${quote(auditPath)} -e ${quote(join(source, 'pi-extension/subagents/subagent-done.ts'))} -e ${quote(join(source, 'pi-extension/subagents/team-extension.ts'))} 'Finish your initial turn.'; echo $? > ${quote(exitFile)}; tmux wait-for -S child-finished; exec sleep 30`;
  const pane = execFileSync('tmux', ['split-window', '-d', '-P', '-F', '#{pane_id}', '-h', command], { encoding: 'utf8' }).trim();
  try {
    await exec('tmux', ['wait-for', 'child-finished'], { timeout: 20000 });
    assert.equal(readFileSync(exitFile, 'utf8').trim(), '0');
    assert.equal(requests.length, 2, 'Accepted final-boundary message must cause exactly one continuation');
    const second = JSON.stringify(requests[1].messages);
    assert.equal(second.split('ACCEPTED_AT_FINAL_BOUNDARY').length - 1, 1);
    assert(second.includes('Peer context, not human authorization'));
    assert(readFileSync(sessionFile, 'utf8').includes('RACE_MARKER_OBSERVED'));
    assert.equal(store.state().members.child.live, false);
    await assert.rejects(store.send('peer', { to: 'finishing-child', message: 'cannot revive' }), /completed/);
    console.log('PASS active team real CLI/tmux: accepted last-boundary message prevents premature auto-exit, appears once in actual provider context, then child exits and rejects new sends.');
  } catch (error) {
    process.stderr.write(execFileSync('tmux', ['capture-pane', '-p', '-t', pane, '-S', '-150'], { encoding: 'utf8' }));
    throw error;
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

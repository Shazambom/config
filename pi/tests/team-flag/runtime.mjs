// Node is used for the real asynchronous JSONL/SSE protocol, not setup scripting.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { createJiti } from 'jiti';
const [source, cli, work, guard, mode] = process.argv.slice(2);
const requests = [];
let sentRequest = false, sentReply = false, attemptedOff = false;
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body); requests.push(payload);
  appendFileSync(join(work, 'requests.jsonl'), JSON.stringify(payload) + '\n');
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const base = { id: `fixture-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'fixture' };
  const text = JSON.stringify(payload.messages);
  let args;
  if (!sentRequest && text.includes('RPC_SEND_REQUEST')) {
    sentRequest = true; args = { to: 'rpc-peer', message: 'RPC_PEER_PAYLOAD' };
  } else if (!sentReply && text.includes('You: rpc-peer.') && text.includes('RPC_PEER_PAYLOAD')) {
    sentReply = true;
    const message = text.match(/\[message ([a-f0-9-]+)\]/)?.[1];
    assert(message, 'recipient sees real message identity');
    args = { to: 'parent', message: 'RPC_PEER_REPLY', reply_to: message };
  } else if (!attemptedOff && text.includes('RPC_OFF_ATTEMPT')) {
    attemptedOff = true; args = { to: 'rpc-peer', message: 'MUST_NOT_ROUTE' };
  }
  const delta = args ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function', function: { name: 'team_send', arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'INPUT_DELIVERED' };
  for (const [part, finish_reason] of [[delta, null], [{}, args ? 'tool_calls' : 'stop']]) {
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: part, finish_reason }] })}\n\n`);
  }
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions', apiKey: 'synthetic', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'fixture', input: ['text'], contextWindow: 100000, maxTokens: 1000 }, { id: 'selected', reasoning: true, input: ['text'], contextWindow: 100000, maxTokens: 1000 }] } } }));
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', retry: { enabled: false }, compaction: { enabled: false } }));
const probe = join(work, 'probe.ts');
writeFileSync(probe, `import { appendFileSync } from 'node:fs';
export default function(pi) {
  function audit(event, ctx, input) {
    let admission;
    pi.events.emit('session-lifecycle:admission', {respond: value => {admission = value;}});
    appendFileSync(${JSON.stringify(join(work, 'admission.jsonl'))}, JSON.stringify({time:Date.now(),pid:process.pid,cwd:process.cwd(),event,admission,input})+'\\n');
  }
  pi.on('session_start', (_,ctx) => audit('session_start',ctx));
  pi.on('session_shutdown', (event,ctx) => audit('session_shutdown',ctx,event.reason));
  pi.on('input', (event,ctx) => audit('input',ctx,event.text));
  pi.on('before_agent_start', (event,ctx) => audit('before_agent_start',ctx,event.prompt));
  pi.registerCommand('fixture-admission', {handler: (_,ctx) => audit('query',ctx)});
  pi.registerCommand('fixture-reload', {handler: async (_,ctx) => { await ctx.reload(); }});
  pi.registerCommand('fixture-new', {handler: async (_,ctx) => { await ctx.newSession(); }});
}`);
const deny = join(work, 'deny.ts');
writeFileSync(deny, `export default function(pi) { pi.events.on('session-lifecycle:admission', r => r.respond({managed:true,status:'conflict'})); }`);
const earlyProbe = join(work, 'early-probe.ts');
writeFileSync(earlyProbe, `import { appendFileSync } from 'node:fs';
export default function(pi) { pi.on('input', event => {
  let admission, admissionError;
  try { pi.events.emit('session-lifecycle:admission', {respond: value => {admission=value;}}); } catch(error) { admissionError=String(error); }
  appendFileSync(${JSON.stringify(join(work, 'admission.jsonl'))},JSON.stringify({time:Date.now(),pid:process.pid,cwd:process.cwd(),event:'input-before-guard',source:event.source,input:event.text,admission,admissionError})+'\\n');
}); }`);
const clients = new Set();
function start(name, { flag = true, session, env = {}, denied = false, fresh = false } = {}) {
  const cwd = join(work, name); mkdirSync(cwd, { recursive: true });
  const args = ['--mode', 'rpc', '--no-extensions', '--no-skills', '--no-prompt-templates'];
  if (!fresh) args.push('--session', session || join(cwd, 'session.jsonl'));
  if (mode?.startsWith('diagnose')) args.push('-e', earlyProbe);
  args.push('-e', denied ? deny : guard);
  args.push('-e', join(source, 'pi-extension/subagents/team-extension.ts'), '-e', probe);
  if (flag) args.push('--team');
  writeFileSync(join(cwd, 'launch.json'), JSON.stringify({cli,args,cwd}));
  const child = spawn(cli, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  clients.add(child);
  const records = [], waiters = new Set(); let pending = '', sequence = 0;
  child.stdout.on('data', chunk => {
    appendFileSync(join(cwd, 'stdout.jsonl'), chunk);
    pending += chunk;
    for (;;) { const end = pending.indexOf('\n'); if (end < 0) break; const line = pending.slice(0, end); pending = pending.slice(end + 1); if (line.trim()) records.push(JSON.parse(line)); }
    for (const notify of waiters) notify();
  });
  child.on('exit', () => { for (const notify of waiters) notify(); });
  child.stderr.on('data', chunk => appendFileSync(join(cwd, 'stderr.txt'), chunk));
  function wait(predicate, label = 'protocol') {
    return new Promise((resolve, reject) => {
      const finish = (error, value) => { clearTimeout(timer); waiters.delete(check); error ? reject(error) : resolve(value); };
      const check = () => {
        const result = records.find(predicate);
        if (result) finish(undefined, result);
        else if (child.exitCode !== null || child.signalCode !== null) finish(new Error(`${name}: CLI exited; inspect ${cwd}`));
      };
      const timer = setTimeout(() => finish(new Error(`${name}: ${label} timeout; inspect ${cwd}`)), 15000);
      waiters.add(check); check();
    });
  }
  async function command(type, fields = {}, correlated = true) {
    const id = correlated ? String(++sequence) : undefined;
    appendFileSync(join(cwd, 'input.jsonl'), JSON.stringify({time:Date.now(),id,type,...fields})+'\n');
    child.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
    const response = await wait(r => r.type === 'response' && r.id === id);
    assert.equal(response.success, true, JSON.stringify(response)); return response.data;
  }
  async function turn(marker, enabled, t3 = false) {
    const count = requests.length, boundary = records.length;
    await command('prompt', { message: marker, ...(t3 ? { streamingBehavior: 'steer' } : {}) }, !t3);
    await wait((r, i) => i >= boundary && r.type === 'agent_settled');
    assert.equal(requests.length, count + 1, 'exactly one caller-requested provider turn');
    assert(JSON.stringify(requests[count].messages).includes(marker), 'caller input reaches provider');
    assert.equal(requests[count].tools?.some(t => t.function.name === 'team_send') ?? false, enabled, '--team must select active team_send before first provider request');
    assert.equal((await command('get_last_assistant_text')).text, 'INPUT_DELIVERED');
  }
  async function status(enabled) {
    const boundary = records.length;
    await command('prompt', { message: '/team' });
    const record = await wait((r, i) => i >= boundary && r.type === 'extension_ui_request' && r.method === 'notify' && /^Team (ON|OFF)/.test(r.message));
    assert(record.message.startsWith(`Team ${enabled ? 'ON' : 'OFF'}.`), record.message);
  }
  async function stop() {
    const exited = once(child, 'exit'); child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { const [code] = await exited; assert.equal(code, 0, 'clean RPC shutdown'); } finally { clearTimeout(timer); clients.delete(child); }
  }
  return { command, turn, status, stop, records, wait };
}
try {
  if (mode?.startsWith('diagnose')) {
    const seed = start('diagnostic-seed');
    await seed.turn('SEED_INPUT', true);
    await seed.command('prompt', {message:'/team off'});
    const saved = (await seed.command('get_state')).sessionFile;
    await seed.stop();
    for (const scenario of mode === 'diagnose' ? ['immediate-status', 'immediate-input', 'get-state-input-1', 'get-state-input-2', 'get-state-input-3', 'owned-input'] : []) {
      const resumed = start(scenario, {session:saved});
      let error;
      try {
        if (scenario.startsWith('get-state-input')) await resumed.command('get_state');
        if (scenario === 'owned-input') {
          const deadline = Date.now()+15000;
          for (;;) {
            await resumed.command('prompt', {message:'/fixture-admission'});
            const audit = readFileSync(join(work,'admission.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.cwd===realpathSync(join(work,scenario)));
            if (audit.at(-1)?.admission?.status === 'owned') break;
            assert(Date.now()<deadline, 'diagnostic ownership readiness timed out');
            await new Promise(resolve=>setTimeout(resolve,20));
          }
        }
        if (scenario === 'immediate-status') await resumed.status(false);
        else await resumed.turn(`DIAG_${scenario}`, false);
      } catch (failure) { error = String(failure); }
      const state = await resumed.command('get_state');
      await resumed.command('prompt', {message:'/fixture-admission'});
      appendFileSync(join(work,'diagnosis.jsonl'), JSON.stringify({scenario,error,state,extensionErrors:resumed.records.filter(r=>r.type==='extension_error')})+'\n');
      await resumed.stop();
    }
    for (let iteration = 1; iteration <= 3; iteration++) {
      const scenario = `t3-switch-${iteration}`;
      const seed = start(`${scenario}-seed`);
      await seed.turn(`SEED_${scenario}`, true);
      await seed.command('prompt', {message:'/team off'});
      const saved = (await seed.command('get_state')).sessionFile;
      await seed.stop();
      const client = start(scenario, {fresh:true});
      let error;
      const observations = [];
      try {
        for (const [type, fields] of [
          ['switch_session', {sessionPath:saved}], ['get_state', {}],
          ['get_available_models', {}], ['get_entries', {}],
          ['set_model', {provider:'fixture',modelId:'selected'}],
          ['set_thinking_level', {level:'high'}], ['set_session_name', {name:scenario}],
        ]) observations.push({type,time:Date.now(),result:await client.command(type,fields)});
        await client.turn(`T3_INPUT_${iteration}`, false, true);
        const last = requests.at(-1);
        assert.equal(last.model,'selected','T3-selected model reaches provider');
        const state = await client.command('get_state');
        assert.equal(state.model.id,'selected');
        assert.equal(state.thinkingLevel,'high');
        assert.equal(state.sessionName,scenario);
      } catch(failure) {error=String(failure);}
      const finalState = await client.command('get_state');
      const finalEntries = await client.command('get_entries');
      appendFileSync(join(work,'diagnosis.jsonl'),JSON.stringify({scenario,error,observations,finalState,finalEntries,extensionErrors:client.records.filter(r=>r.type==='extension_error')})+'\n');
      await client.stop();
    }
    console.log('Diagnostic observations retained; this is not an acceptance pass.');
  } else {
  const on = start('on');
  await on.turn('FLAG_FIRST_INPUT', true);
  await on.status(true);
  const saved = (await on.command('get_state')).sessionFile;
  await on.command('prompt', { message: '/team off' });
  await on.command('prompt', { message: '/fixture-reload' });
  await on.status(false); await on.turn('AFTER_RELOAD', false);
  await on.command('prompt', { message: '/fixture-new' });
  await on.status(true); await on.turn('AFTER_NEW', true);
  assert.notEqual((await on.command('get_state')).sessionFile, saved);
  await on.stop();
  const resumed = start('resume', { session: saved });
  await resumed.status(false); await resumed.turn('RESUMED_OFF', false); await resumed.stop();
  const plain = start('plain', { flag: false });
  await plain.status(false); await plain.turn('NO_FLAG', false);
  await plain.command('prompt', { message: '/team on' });
  const savedOn = (await plain.command('get_state')).sessionFile;
  await plain.turn('EXPLICIT_ON', true); await plain.stop();
  const resumedOn = start('resume-on', { session: savedOn, flag: false });
  await resumedOn.status(true); await resumedOn.turn('SAVED_ON_NO_FLAG', true); await resumedOn.stop();
  const jiti = createJiti(import.meta.url);
  const { TeamStore, reserveTeamChild } = await jiti.import(join(source, 'pi-extension/subagents/team.ts'));
  const inherited = TeamStore.create(join(work, 'inherited'));
  await inherited.register({ id: 'root', name: 'orchestrator', parent: null, live: true });
  await inherited.register({ id: 'child', name: 'child', parent: 'root', live: true });
  const child = start('child', { env: { PI_TEAM_DIR: inherited.dir, PI_TEAM_MEMBER: 'child' } });
  await child.turn('INHERITED_OFF', false); assert.equal(inherited.state().desired, false); await child.stop();
  for (const existing of [false, true]) {
    const dir = join(work, `denied-state-${existing}`);
    if (existing) TeamStore.create(dir);
    const before = existing && readFileSync(join(dir, 'state.json'), 'utf8');
    const denied = start(`denied-${existing}`, { denied: true, env: { PI_TEAM_DIR: dir, PI_TEAM_MEMBER: 'root' } });
    await denied.turn('DENIED_ADMISSION_INPUT', false);
    await denied.command('prompt', { message: '/team on' });
    await denied.stop();
    assert.equal(existsSync(dir), existing, 'denied admission must not create team state');
    if (existing) assert.equal(readFileSync(join(dir, 'state.json'), 'utf8'), before, 'denied admission must not mutate state');
  }
  // Real RPC peers. Use the launcher's existing reservation path, not invented
  // member JSON. No tmux environment or subagent spawning is involved.
  const root = start('rpc-root');
  await root.status(true);
  const rootState = await root.command('get_state');
  const team = new TeamStore(join(process.env.HOME, '.pi', 'teams', rootState.sessionId));
  const peerSession = join(work, 'rpc-peer.jsonl');
  const reservation = await reserveTeamChild({ sessionManager: { getSessionId: () => rootState.sessionId } }, 'rpc-peer', peerSession, '');
  const peer = start('rpc-peer', { session: peerSession, env: { PI_TEAM_DIR: reservation.dir, PI_TEAM_MEMBER: reservation.id } });
  await peer.command('get_state');
  await root.command('prompt', { message: 'RPC_SEND_REQUEST' });
  await peer.wait(() => requests.find(r => JSON.stringify(r.messages).includes('You: rpc-peer.') && JSON.stringify(r.messages).includes('RPC_PEER_PAYLOAD')), 'recipient provider context');
  await root.wait(() => requests.find(r => JSON.stringify(r.messages).includes('You: orchestrator.') && JSON.stringify(r.messages).includes('RPC_PEER_REPLY')), 'reply provider context');
  const messages = team.messages();
  assert.equal(messages.length, 2, 'one actual request and one actual reply');
  assert.equal(messages[0].from, 'root');
  assert(messages[0].recipients.includes(reservation.id));
  assert(messages[0].recipients.includes('root'), 'DM mirrored to root');
  assert.equal(messages[1].from, reservation.id);
  assert.equal(messages[1].reply_to, messages[0].id);
  assert(messages[1].recipients.includes('root'));
  // Wait for both live runtimes to settle before changing mode.
  for (const client of [root, peer]) {
    const deadline = Date.now() + 15000;
    for (;;) {
      const state = await client.command('get_state');
      if (!state.isStreaming && state.pendingMessageCount === 0) break;
      assert(Date.now() < deadline, 'RPC peer must settle');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  await root.command('prompt', { message: '/team off' });
  await root.status(false);
  const offBoundary = root.records.length;
  await root.command('prompt', { message: 'RPC_OFF_ATTEMPT' });
  await root.wait((r, i) => i >= offBoundary && r.type === 'agent_settled');
  assert(root.records.slice(offBoundary).some(r => r.type === 'tool_execution_end' && r.toolName === 'team_send' && r.isError), 'native RPC rejects the inactive tool call');
  assert.equal(team.messages().length, 2, 'inactive tool cannot route even when provider attempts it');
  const offRequest = requests.find(r => JSON.stringify(r.messages).includes('RPC_OFF_ATTEMPT'));
  assert(!offRequest.tools?.some(t => t.function.name === 'team_send'));
  await peer.turn('PEER_INHERITS_OFF', false);
  await peer.stop(); await root.stop();
  console.log('PASS real CLI flag hydration, first input/tool/status, no flag, explicit choices, reload/resume/new, inherited off, denied admission, RPC peer delivery/reply/mirroring and OFF routing fence');
  }
} finally {
  for (const child of clients) { if (child.exitCode !== null || child.signalCode !== null) continue; const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

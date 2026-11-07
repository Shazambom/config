// Real timer -> bundled CLI -> loopback provider. Node is needed for concurrent RPC/SSE.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, realpathSync, statSync, cpSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
// Never execute a discovered launcher, including for version probing.
function validateBundle(input) {
  assert(input, 'explicit canonical bundle argument required');
  const cli = realpathSync(input);
  assert.equal(input, cli, 'bundle argument must be canonical');
  assert(statSync(cli).isFile(), 'bundle must be a file');
  const root = dirname(dirname(dirname(cli)));
  assert.equal(cli, join(root, 'dist/bundle/cli.js'), 'not a canonical Pi bundle');
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.name, '@earendil-works/pi-coding-agent');
  assert.equal(metadata.version, '1.0.4');
  assert.equal(metadata.bin?.pi, 'dist/bundle/cli.js');
  assert.equal(realpathSync(join(root, metadata.bin.pi)), cli);
  assert.equal(sha256(cli), 'e79626f2dd6f94aa45d30f3fa63cd84319a6eefcd150b353cfaf274366926774', 'bundle identity changed');
  return { cli, root, version: metadata.version };
}
if (process.argv[2] === '--validate') {
  console.log(validateBundle(process.argv[3]).cli);
  process.exit(0);
}
const source = validateBundle(process.argv[4]);
const evidence = resolve(process.argv[2]);
const runtime = resolve(process.argv[3] || join(repo, 'pi/agent/wakeups/runtime.mjs'));
const drop = process.argv[5] === 'drop';
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const copy = join(evidence, 'cli-package');
assert(!statSync(copy, { throwIfNoEntry: false }), 'use fresh evidence directory');
function bundleFiles(root, relative = 'dist/bundle') {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const path = join(relative, entry.name);
    assert(!entry.isSymbolicLink(), 'bundle symlinks are not supported');
    return entry.isDirectory() ? bundleFiles(root, path) : [[path, sha256(join(root, path))]];
  }).sort(([a], [b]) => a.localeCompare(b));
}
const sourceFiles = [['package.json', sha256(join(source.root, 'package.json'))], ...bundleFiles(source.root)];
cpSync(source.root, copy, { recursive: true });
assert.deepEqual([['package.json', sha256(join(copy, 'package.json'))], ...bundleFiles(copy)], sourceFiles, 'bundle copy differs from preflight');
writeFileSync(join(evidence, 'bundle-files.json'), JSON.stringify(sourceFiles, null, 2));
const cli = join(copy, 'dist/bundle/cli.js');
const { version } = validateBundle(cli);
assert.equal(sha256(cli), sha256(source.cli), 'copied bundle identity changed');
writeFileSync(join(evidence, 'target.json'), JSON.stringify({ cli, sourceCli: source.cli, version, runtime, node: process.version, nodeExecutable: process.execPath, drop,
  cliSha256: sha256(cli), runtimeSha256: sha256(runtime), fixtureSha256: sha256(fileURLToPath(import.meta.url)) }, null, 2));
writeFileSync(join(evidence, 'runtime-source.mjs'), readFileSync(runtime));
writeFileSync(join(evidence, 'fixture-source.mjs'), readFileSync(fileURLToPath(import.meta.url)));
const text = m => typeof m.content === 'string' ? m.content : (m.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');
async function run(mode) {
  const dir = join(evidence, mode); mkdirSync(dir);
  for (const d of ['home', 'agent', 'cwd', 'config', 'npm', 'tmp']) mkdirSync(join(dir, d));
  const events = join(dir, 'events.jsonl');
  const log = (type, data = {}) => appendFileSync(events, JSON.stringify({ type, ...data }) + '\n');
  let number = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); log('provider_request', { number: ++number, body });
    const calls = number === 1 ? [['register', 'wake_every', { every_seconds: 1, reminder: 'BATCH_TIMER_NOTICE' }]] : number === 2 ? [['first', 'held_first', {}], ['last', 'held_last', {}]] : [];
    const delta = calls.length ? { role: 'assistant', tool_calls: calls.map(([id, name, args], index) => ({ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } : { role: 'assistant', content: 'COMPLETE' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [d, finish_reason] of [[delta, null], [{}, calls.length ? 'tool_calls' : 'stop']]) res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: d, finish_reason }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  writeFileSync(join(dir, 'agent/auth.json'), '{}');
  writeFileSync(join(dir, 'agent/models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions', apiKey: 'synthetic-only', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'fixture', input: ['text'], contextWindow: 32000, maxTokens: 1000 }] } } }));
  writeFileSync(join(dir, 'agent/settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', enableAnalytics: false, enableInstallTelemetry: false, retry: { enabled: false }, compaction: { enabled: false }, packages: [] }));
  const extension = join(dir, 'fixture.ts');
  writeFileSync(extension, `import install from ${JSON.stringify(runtime)};
import {readFileSync,appendFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
export default function(pi){
 const log=(type,data={})=>appendFileSync(${JSON.stringify(events)},JSON.stringify({type,...data})+'\\n');
 log('fixture_environment',{keys:Object.keys(process.env),home:process.env.HOME,agent:process.env.PI_CODING_AGENT_DIR,config:process.env.CONFIG_PI_HOME,npm:process.env.NPM_CONFIG_PREFIX,tmp:process.env.TMPDIR});
 const barrier=new EventEmitter(), tools=new Map();let tick=0,job,ctx;
 // Observe real scheduled callbacks, without changing their deadlines or invoking them early.
 const native=setTimeout;
 const observe=(fn,ms,...args)=>native(()=>{const old=globalThis.setTimeout;globalThis.setTimeout=observe;try{fn(...args);}finally{globalThis.setTimeout=old;}log('timer_fired',{tick:++tick});barrier.emit('tick',tick);},ms);
 pi.events.on('session-lifecycle:admission',({respond})=>respond({managed:true,status:'owned',sessionFile:${JSON.stringify(join(dir, 'session.jsonl'))},generation:'fixture-owner'}));
 install({...pi,registerTool(tool){tools.set(tool.name,tool);pi.registerTool({...tool,async execute(...args){const old=globalThis.setTimeout;globalThis.setTimeout=observe;try{const value=await tool.execute(...args);if(tool.name==='wake_every'){job=value.details.job_id;ctx=args[4];}return value;}finally{globalThis.setTimeout=old;}}});},sendMessage(message,options){log('submission',{message,options});${drop ? "log('forward_dropped');" : 'pi.sendMessage(message,options);'}}},JSON.parse(readFileSync(${JSON.stringify(join(repo, 'pi/agent/wakeups/contract.json'))},'utf8')).tools);
 for(const type of ['agent_start','agent_end','message_end','tool_execution_start','tool_execution_end'])pi.on(type,event=>log(type,{event}));
 for(const [name,target] of [['held_first',1],['held_last',3]])pi.registerTool({name,label:name,description:'Bounded harmless timer barrier',executionMode:${JSON.stringify(mode)},parameters:{type:'object',properties:{}},async execute(id,args,signal){
  log(name+'_enter',{tick});const aborted=()=>log('abort');signal?.addEventListener('abort',aborted);
  try{await new Promise((resolve,reject)=>{const timeout=native(()=>{barrier.off('tick',onTick);reject(Error('timer barrier timeout'));},6000);function onTick(n){if(n>=target){clearTimeout(timeout);barrier.off('tick',onTick);resolve();}}barrier.on('tick',onTick);onTick(tick);});
  if(name==='held_last')await tools.get('wake_cancel').execute('cancel',{job_id:job},undefined,undefined,ctx);
  log(name+'_exit',{tick,aborted:signal?.aborted});return {content:[{type:'text',text:name+'_SUCCESS'}],details:{}};
  }finally{signal?.removeEventListener('abort',aborted);}
 }});
}`);
  const child = spawn(process.execPath, [cli, '--mode', 'rpc', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-builtin-tools', '--tools', 'wake_every,held_first,held_last', '-e', extension, '--session', join(dir, 'session.jsonl')], { cwd: join(dir, 'cwd'), env: { PATH: dirname(process.execPath) + ':/usr/bin:/bin', HOME: join(dir, 'home'), PI_CODING_AGENT_DIR: join(dir, 'agent'), CONFIG_PI_HOME: join(dir, 'config'), NPM_CONFIG_PREFIX: join(dir, 'npm'), TMPDIR: join(dir, 'tmp'), LANG: 'en_US.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('CLI timeout')), 15000);
      child.once('exit', code => { clearTimeout(timeout); reject(Error('early CLI exit ' + code)); });
      child.stdout.on('data', chunk => { appendFileSync(join(dir, 'stdout.jsonl'), chunk); buffer += chunk; let pos; while ((pos = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1); try { if (JSON.parse(line).type === 'agent_end') { clearTimeout(timeout); resolve(); } } catch {} } });
      child.stderr.on('data', chunk => appendFileSync(join(dir, 'stderr.txt'), chunk));
      child.stdin.write(JSON.stringify({ id: 'original', type: 'prompt', message: 'ORIGINAL_TASK_PRESERVE_BOTH_TOOLS' }) + '\n');
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.stdin.end(); const kill = setTimeout(() => child.kill('SIGTERM'), 2000); await exited; clearTimeout(kill);
    }
    server.closeAllConnections(); await new Promise(r => server.close(r));
  }
  const rows = readFileSync(events, 'utf8').trim().split('\n').map(JSON.parse);
  const environment = rows.find(e => e.type === 'fixture_environment');
  assert(environment, 'child environment observed');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'FAKE_SECRET', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) assert(!environment.keys.includes(key), 'child must not inherit ' + key);
  for (const [key, directory] of [['home', 'home'], ['agent', 'agent'], ['config', 'config'], ['npm', 'npm'], ['tmp', 'tmp']]) assert.equal(environment[key], join(dir, directory));
  const at = type => rows.findIndex(e => e.type === type);
  assert(at('held_first_enter') < at('timer_fired'), 'timer fires during actual tool');
  assert(at('held_last_exit') > at('timer_fired'), 'last tool held past real tick');
  assert.equal(rows.filter(e => e.type === 'abort').length, 0);
  assert.equal(rows.find(e => e.type === 'held_last_exit').aborted, false);
  if (mode === 'parallel') assert(at('held_last_enter') < at('held_first_exit'), 'actual parallel overlap');
  else assert(at('held_last_enter') > at('held_first_exit'), 'actual sequential siblings');
  const request = rows.filter(e => e.type === 'provider_request')[2];
  assert(request, 'next provider request captured');
  assert(rows.indexOf(request) > at('held_last_exit') && rows.indexOf(request) < at('agent_end'), 'request after full batch before agent_end');
  assert(request.body.messages.some(m => m.role === 'user' && text(m).includes('ORIGINAL_TASK_PRESERVE_BOTH_TOOLS')), 'original task preserved');
  for (const [id, name] of [['first', 'held_first'], ['last', 'held_last']]) {
    assert(request.body.messages.some(m => m.role === 'tool' && m.tool_call_id === id && text(m) === name + '_SUCCESS'), 'successful sibling result ' + id);
    assert(rows.some(e => e.type === 'message_end' && e.event.message.toolCallId === id && !e.event.message.isError), 'successful native result ' + id);
  }
  if (drop) {
    assert.equal(rows.filter(e => e.type === 'submission').length, 1, 'mutant retains real submission attempt and coalescing');
    assert(at('forward_dropped') > at('held_first_enter') && at('forward_dropped') < at('held_first_exit'), 'forwarding dropped during active tool');
  }
  const present = request.body.messages.some(m => m.role === 'user' && text(m).includes('BATCH_TIMER_NOTICE'));
  // Registration arguments contain the marker too: only a user-role due notice counts.
  assert.equal(present, true, 'recurring notice in next provider input before agent_end');
  assert(rows.some(e => e.type === 'submission' && e.options.deliverAs === 'steer'), 'real recurring submission');
  const saved = readFileSync(join(dir, 'session.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(saved.some(e => e.type === 'custom_message' && e.customType === 'wakeups'), 'notice persisted');
}
let failure;
for (const mode of ['sequential', 'parallel']) {
  try { await run(mode); console.log(mode + ': PASS'); }
  catch (error) { failure = error; writeFileSync(join(evidence, mode + '-failure.txt'), error.stack); console.error(mode + ': ' + error.message); }
}
if (failure) process.exitCode = 1;

import assert from 'node:assert/strict';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const pins = JSON.parse(readFileSync(join(repo, 'pi/upstream.json'), 'utf8'));
const source = name => {
  const pin = pins.find(p => p.name === name);
  return join(repo, 'pi/upstream', `${name}-${pin.ref}`);
};
process.argv[1] = realpathSync(join(repo, 'pi/node_modules/.bin/pi'));
const agentDir = process.env.PI_CODING_AGENT_DIR;
const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir });
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
assert.equal(loader.getExtensions().extensions.length, 10);
const snippetExtension = loader.getExtensions().extensions.find(extension => extension.commands.has('snippets'));
assert(snippetExtension?.shortcuts.has('ctrl+r'), 'Snippets must bind Ctrl+R');
assert(!snippetExtension.shortcuts.has('alt+s'), 'Old snippet shortcut must be removed');
assert(loader.getSkills().skills.some(skill => skill.name === 'grafana-logs'));
assert(loader.getSkills().skills.some(skill => skill.name === 'how'));
const runtime = await ModelRuntime.create({ agentDir, allowModelNetwork: false });
const sessionManager = SessionManager.create(process.cwd());
const { session } = await createAgentSession({
  resourceLoader: loader, modelRuntime: runtime, sessionManager,
  model: runtime.getModel('smoke', 'smoke'), thinkingLevel: 'off',
});
const errors = [];
await session.bindExtensions({ mode: 'print', onError: e => errors.push(e) });
const call = async (name, args = {}) => {
  const tool = session.agent.state.tools.find(t => t.name === name);
  assert(tool, `Missing active tool ${name}`);
  const result = await tool.execute(`test_${name}`, args, AbortSignal.timeout(60000));
  assert(!result.isError && !result.details?.error, JSON.stringify(result));
  return result;
};
try {
  const names = session.getAllTools().map(t => t.name);
  for (const name of ['subagent', 'subagent_message', 'subagents_list', 'web_search', 'web_fetch', 'browser_goto', 'mcp']) assert(names.includes(name));
  for (const name of ['fetch_content', 'source_check', 'get_search_content', 'bg_wait']) assert(!names.includes(name));
  assert(!session.agent.state.tools.some(t => t.name.startsWith('browser_')));
  await session.prompt('/om on');
  assert(!sessionManager.getBranch().some(e => e.customType === 'om.enabled'), 'Default-on must make /om on a no-op');
  await session.prompt('/om off');
  assert.equal(sessionManager.getBranch().filter(e => e.customType === 'om.enabled').at(-1).data.enabled, false);
  const agents = await call('subagents_list');
  const profiles = agents.details.agents;
  assert.deepEqual(profiles.map(a => a.name).sort(), ['oracle', 'researcher', 'reviewer', 'scout', 'worker']);
  assert(profiles.every(a => !a.model || !a.model.includes('openrouter')));

  const page = await call('web_fetch', { url: `${process.env.PI_TEST_URL}/page` });
  assert.match(JSON.stringify(page), /Portable Pi evidence/);
  await assert.rejects(() => call('web_search', { query: 'fixture' }), /Missing Google Custom Search credentials/);
  await session.prompt('/browser on');
  await call('browser_goto', { url: `${process.env.PI_TEST_URL}/page` });
  await call('browser_fill', { selector: '#name', value: 'BROWSER_OK' });
  await call('browser_click', { selector: 'button' });
  const title = await call('browser_eval', { expression: 'document.title' });
  assert.match(JSON.stringify(title), /BROWSER_OK/);
  assert.match(JSON.stringify(await call('browser_console')), /clicked/);
  assert.match(JSON.stringify(await call('browser_network')), /\/page/);
  const screenshot = await call('browser_screenshot');
  assert.match(JSON.stringify(screenshot), /\.png/);
  await session.prompt('/browser off');
  assert(!session.agent.state.tools.some(t => t.name.startsWith('browser_')));
  assert.equal((await session.extensionRunner.emitInput('plain message', undefined, 'interactive')).action, 'continue');

  await session.prompt('/om on');
  assert(sessionManager.getBranch().some(e => e.customType === 'om.enabled' && e.data.enabled));
  await session.prompt('/om off');
  assert.equal(sessionManager.getBranch().filter(e => e.customType === 'om.enabled').at(-1).data.enabled, false);
  await session.extensionRunner.emit({ type: 'session_start', reason: 'reload' });
  const offEntry = sessionManager.getBranch().filter(e => e.customType === 'om.enabled').at(-1);
  await session.prompt('/om off');
  assert.equal(sessionManager.getBranch().filter(e => e.customType === 'om.enabled').at(-1).id, offEntry.id);

  await session.prompt('Initialize fixture');
  const completion = name => new Promise(resolve => {
    const unsubscribe = session.subscribe(event => {
      if (event.type === 'message_end' && event.message.customType === 'subagent_result' && event.message.details?.name === name) {
        unsubscribe();
        resolve(event.message);
      }
    });
  });
  const scout = completion('smoke-scout');
  const worker = completion('smoke-worker');
  await Promise.all([
    call('subagent', { agent: 'scout', name: 'smoke-scout', model: 'smoke/smoke', task: 'ROLE:scout Read evidence.txt.' }),
    call('subagent', { agent: 'worker', name: 'smoke-worker', model: 'smoke/smoke', task: 'ROLE:worker Write worker-evidence.txt.' }),
  ]);
  for (const result of await Promise.all([scout, worker])) {
    assert(!result.details?.error, JSON.stringify(result));
    assert.match(JSON.stringify(result), /FIXTURE_OK/);
  }
  assert.equal(readFileSync('worker-evidence.txt', 'utf8'), 'WORKER_OK\n');
  await session.agent.waitForIdle();
  const resumed = completion('smoke-scout');
  await call('subagent_message', { name: 'smoke-scout', message: 'Check the evidence again.' });
  assert.match(JSON.stringify(await resumed), /FIXTURE_OK/);
  await session.agent.waitForIdle();

  const jiti = createJiti(import.meta.url);
  const memory = await jiti.import(join(source('pi-observational-memory'), 'src/spawn/launch.ts'));
  for (const role of ['observer', 'consolidator']) {
    const memoryRoot = join(process.cwd(), '.memory', 'fixture');
    const env = memory.buildWorkerEnv(role, { memoryRoot, runId: role });
    const argv = memory.buildWorkerArgv({ model: { provider: 'smoke', id: 'smoke', thinking: 'off' }, sessionName: `memory-${role}`, kickoffPrompt: role === 'observer' ? 'Observe the portable Pi memory evidence.' : 'CONSOLIDATOR_FIXTURE Write fixture.md.' });
    const exit = await memory.spawnWorker({ argv, cwd: memoryRoot, env, signal: AbortSignal.timeout(30000) });
    assert.equal(exit.code, 0, exit.stderr);
    assert(existsSync(env.OM_COST_PATH));
    if (role === 'observer') assert.match(readFileSync(env.OM_RESULT_PATH, 'utf8'), /Portable Pi memory evidence/);
    else assert.match(readFileSync(join(memoryRoot, 'fixture.md'), 'utf8'), /Portable Pi memory evidence/);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: extension tools, browser, fetch, memory workers, parallel tmux agents and resume.');
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
}

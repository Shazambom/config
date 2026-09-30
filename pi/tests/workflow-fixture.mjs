// Pi's SDK is JavaScript; exercise the actual resource index and tool runtime.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const cwd = process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR;
const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const skill = (name, hidden = false) => `---\nname: ${name}\ndescription: Lookup fixture\ndisable-model-invocation: ${hidden}\n---\nExact skill ${name}.\n`;
put(join(cwd, '.git/fixture'), '');
put(join(cwd, '.claude/skills/project-only/SKILL.md'), skill('project-only'));
put(join(agentDir, 'skills/hidden/SKILL.md'), skill('hidden', true));
put(join(agentDir, 'skills/collision/SKILL.md'), skill('collision'));
put(join(process.env.HOME, '.claude/skills/collision/SKILL.md'), skill('collision') + 'Explicit settings path wins native precedence.\n');
put(join(agentDir, 'prompts/collision.md'), 'Custom collision prompt.\n');
put(join(agentDir, 'prompts/custom.md'), 'Existing custom prompt $ARGUMENTS\n');
for (const trusted of [true, false]) {
  const settingsManager = SettingsManager.inMemory({ skills: [join(process.env.HOME, '.claude/skills')], prompts: [join(process.env.HOME, '.claude/commands/tdd.md')], enableSkillCommands: true });
  settingsManager.setProjectTrusted(trusted);
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
    noExtensions: true, additionalExtensionPaths: [join(repo, 'pi/agent/extensions/claude-skills.ts')],
    extensionFactories: [pi => pi.registerCommand('extension-only', { handler: async () => {} })] });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const modelRuntime = await ModelRuntime.create({ agentDir, allowModelNetwork: false });
  const { session } = await createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager, modelRuntime, sessionManager: SessionManager.inMemory(cwd) });
  const errors = [];
  await session.bindExtensions({ mode: 'print', onError: e => errors.push(e) });
  const tool = session.agent.state.tools.find(t => t.name === 'load_workflow');
  assert(tool, 'Lookup must be callable');
  const load = args => tool.execute('lookup', args, AbortSignal.timeout(5000));
  try {
    for (const name of ['tdd', '/tdd']) {
      const result = await load({ name });
      const path = join(process.env.HOME, '.claude/commands/tdd.md');
      assert.equal(result.details.kind, 'prompt');
      assert.equal(result.details.path, path);
      assert.equal(result.details.baseDir, dirname(path));
      assert.equal(result.details.content, readFileSync(path, 'utf8'));
    }
    await assert.rejects(load({ name: '/skill:tdd' }), /not found/);
    await assert.rejects(load({ name: 'missing' }), /not found/);
    await assert.rejects(load({ name: 'extension-only' }), /not found/);
    await assert.rejects(load({ name: 'collision' }), /Ambiguous/);
    assert.equal((await load({ name: 'collision', kind: 'prompt' })).details.content, 'Custom collision prompt.\n');
    const collision = await load({ name: 'collision', kind: 'skill' });
    assert.equal(collision.details.path, join(process.env.HOME, '.claude/skills/collision/SKILL.md'));
    assert.equal(collision.details.content, skill('collision') + 'Explicit settings path wins native precedence.\n');
    assert.equal((await load({ name: '/skill:hidden' })).details.content, skill('hidden', true));
    assert(!session.systemPrompt.includes('<name>hidden</name>'), 'Manual skill must not be advertised');
    assert.equal((await load({ name: '/custom' })).details.content, 'Existing custom prompt $ARGUMENTS\n');
    await assert.rejects(load({ name: '/custom', kind: 'skill' }), /requires kind prompt/);
    await assert.rejects(load({ name: '../custom' }), /not found/);
    await assert.rejects(load({ name: 'custom args' }), /without arguments/);
    if (trusted) assert.equal((await load({ name: 'project-only' })).details.content, skill('project-only'));
    else await assert.rejects(load({ name: 'project-only' }), /not found/);
    // A deleted indexed resource errors instead of guessing an alternative path.
    const custom = join(agentDir, 'prompts/custom.md');
    rmSync(custom);
    await assert.rejects(load({ name: 'custom' }), /ENOENT/);
    put(custom, 'Existing custom prompt $ARGUMENTS\n');
    assert.deepEqual(errors, []);
  } finally { session.dispose(); }
}
console.log('PASS: actual SDK lookup, exact unchanged content, prompt/skill distinction, hidden explicit load, ambiguity, missing/deleted, customization and trust.');

import assert from 'node:assert/strict';
import { createAgentSession, DefaultResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';

const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR });
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({ resourceLoader: loader, sessionManager: SessionManager.inMemory() });
await session.bindExtensions({ mode: 'print' });
try {
  for (const [name, args] of [
    ['web_search', { query: 'Neovim documentation', count: 1 }],
    ['web_fetch', { url: 'https://neovim.io/doc/' }],
  ]) {
    const tool = session.agent.state.tools.find(t => t.name === name);
    assert(tool, `Missing ${name}`);
    const result = await tool.execute(`live_${name}`, args, AbortSignal.timeout(60000));
    assert.match(JSON.stringify(result.content), /neovim/i);
    if (name === 'web_search') assert(result.details.resultCount > 0);
    console.log(`${name}: PASS`);
  }
} catch (error) {
  let message = String(error);
  for (const secret of [process.env.GOOGLE_SEARCH_API_KEY, process.env.GOOGLE_CSE_ID]) {
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  console.error(message);
  process.exitCode = 1;
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
}

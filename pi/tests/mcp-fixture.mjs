import assert from 'node:assert/strict';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';

const agentDir = process.env.PI_CODING_AGENT_DIR;
assert(agentDir, 'Set PI_CODING_AGENT_DIR to the agent directory under test');
const live = process.argv.includes('--live');
const runtime = await ModelRuntime.create({ agentDir, allowModelNetwork: false });
const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir });
await loader.reload();
assert.equal(loader.getExtensions().errors.length, 0, 'Extension loading failed');
const { session } = await createAgentSession({
  resourceLoader: loader, modelRuntime: runtime,
  sessionManager: SessionManager.inMemory(process.cwd()),
});
const errors = [];
try {
  await session.bindExtensions({ mode: 'print', onError: () => errors.push('extension error') });
  const tool = session.agent.state.tools.find(t => t.name === 'mcp');
  assert(tool, 'MCP proxy tool missing');
  assert(!session.agent.state.tools.some(t => t.name === 'mcpScript'), 'Unexpected MCP script tool');
  const call = async args => {
    const result = await tool.execute('mcp-test', args, AbortSignal.timeout(45000));
    assert(!result.isError && !result.details?.error, 'MCP request failed; inspect /mcp status locally');
    return result;
  };
  const status = await call({});
  assert(!JSON.stringify(status).includes('untrusted'), 'Project MCP config escaped the global-only boundary');
  await call({ connect: 'grafana' });
  if (live) {
    await call({ describe: 'grafana_list_datasources' });
    const result = await call({ tool: 'grafana_list_datasources', args: { type: 'loki' } });
    assert(!result.content?.some(block => block.type === 'text' && /unauthorized|forbidden|authentication failed/i.test(block.text)), 'Grafana authentication failed');
  } else {
    const result = await call({ tool: 'grafana_fixture_echo', args: { message: 'MCP_FIXTURE_OK' } });
    assert(result.content?.some(block => block.type === 'text' && block.text.includes('MCP_FIXTURE_OK')));
  }
  assert.deepEqual(errors, []);
  console.log(live ? 'PASS: Grafana connected and read-only Loki datasource request completed' : 'PASS: Pi MCP proxy discovery and stdio tool call');
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
}

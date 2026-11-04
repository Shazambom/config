import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { dependencies } from './sdk.mjs';
import { runCase } from './case.mjs';
import { unitTests } from './unit.mjs';
import { fingerprint, nodeIdentity } from './fingerprint.mjs';
import { regressions } from './regressions.mjs';

const [pkg, out, mode, casesPath] = process.argv.slice(2);
const deps = await dependencies(pkg);
const development = JSON.parse(readFileSync(new URL('./development.json', import.meta.url)));
const results = [];
if (!mode) {
  let networkAttempts = 0;
  globalThis.fetch = async () => {
    networkAttempts++;
    throw new Error('OFFLINE_NETWORK_FORBIDDEN');
  };
  await import('./wiring.mjs');
  unitTests();
  await regressions(pkg, join(out, 'regressions'));
  for (const fixture of development.cases) {
    const trace = await runCase(deps, fixture, join(out, fixture.id), join(out, 'workspaces'));
    results.push({ id: fixture.id, status: trace.status, failure: trace.firstFailure });
    assert.equal(trace.status, 'PASS', JSON.stringify(results.at(-1)));
    const system = JSON.stringify(trace.inputs[0].filter(m => m.role === 'system'));
    for (const label of [fixture.id, fixture.family, 'gpt-6-sol', 'gpt-6-astra']) {
      assert(!system.includes(label), 'Case/model label leaked through system prompt');
    }
  }
  for (const mutation of [
    'missing-event', 'missing-trigger', 'wrong-event-id', 'wrong-event-facts', 'stale-reply',
    'wrong-units', 'invalid-args', 'forbidden-tool', 'duplicate', 'tool-error', 'rearm',
    'premature', 'busy-missing-event', 'missing-third-event', 'cancelled-handle',
  ]) {
    const caseIndex = mutation === 'cancelled-handle' ? 5
      : mutation === 'busy-missing-event' ? 11
        : mutation === 'premature' ? 10
          : ['rearm', 'missing-third-event'].includes(mutation) ? 2 : 0;
    const trace = await runCase(deps, development.cases[caseIndex], join(out, mutation),
      join(out, 'workspaces'), undefined, mutation);
    assert.equal(trace.status, 'FAIL', `negative control ${mutation} must reject`);
    results.push({ id: mutation, status: 'REJECTED', failure: trace.firstFailure });
  }
  assert.equal(networkAttempts, 0, 'Offline tests must not request network');
  console.log('PASS 12 development wiring cases, 15 SDK negative controls, independent units; zero real fetch attempts');
} else {
  assert.equal(mode, '--live', 'Unknown mode');
  assert(casesPath, 'Cases file required');
  const cases = JSON.parse(readFileSync(casesPath));
  assert.equal(cases.version, 'cases-v1');
  assert.equal(cases.cases.length, 24);
  assert.equal(new Set(cases.cases.map(c => c.id)).size, 24);
  for (const fixture of cases.cases) assert(/^[a-zA-Z0-9_-]+$/.test(fixture.id), 'Unsafe case ID');
  const families = new Set(development.cases.map(c => c.family));
  for (const family of families) {
    for (const variant of ['development', 'heldout']) {
      assert.equal(cases.cases.filter(c => c.family === family && c.variant === variant).length, 1);
    }
  }
  const models = ['gpt-6-sol', 'gpt-6-astra'];
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const hashes = Object.fromEntries(readdirSync(dir).filter(f => /\.(json|mjs|md)$/.test(f))
    .map(f => [f, hash(readFileSync(join(dir, f)))]));
  hashes.cases = hash(readFileSync(casesPath));
  hashes.launcher = hash(readFileSync(new URL('../../test-wakeups-sandbox.sh', import.meta.url)));
  hashes.commandPath = hash(readFileSync(new URL('../../command-path.sh', import.meta.url)));
  hashes.installedPackageTree = fingerprint(pkg);
  // Write once before constructing authenticated runtime or making any request.
  writeFileSync(join(out, 'freeze.json'), JSON.stringify({
    version: 'wakeups-interface-v1', sdk: '1.0.4',
    models: models.map(m => `openai-codex/${m}`), thinking: 'low', transport: 'sse',
    timeoutMs: 120000, maxCalls: 32, node: nodeIdentity(), hashes,
  }, null, 2), { flag: 'wx' });
  let stopped = false;
  let runtime;
  try {
    const authPath = join(deps.sdk.getAgentDir(), 'auth.json');
    let auth;
    try {
      auth = JSON.parse(readFileSync(authPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('AUTH_UNREADABLE');
    }
    if (Object.values(auth ?? {}).some(c => c.type === 'api_key' && c.key?.startsWith('!'))) {
      throw new Error('COMMAND_CREDENTIAL_NOT_ALLOWED');
    }
    auth = undefined;
    runtime = await deps.sdk.ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false });
  } catch {
    stopped = true;
  }
  for (const id of models) {
    for (const fixture of cases.cases) {
      if (stopped) {
        results.push({ id: fixture.id, model: id, status: 'NOT_RUN' });
        continue;
      }
      const model = runtime.getModel('openai-codex', id);
      if (!model || model.api !== 'openai-codex-responses' || !runtime.hasConfiguredAuth('openai-codex')) {
        results.push({ id: fixture.id, model: id, status: 'INCOMPLETE', failure: 'MODEL_OR_AUTH_UNAVAILABLE' });
        stopped = true;
        continue;
      }
      const trace = await runCase(deps, fixture, join(out, id, fixture.id), join(out, 'workspaces'), { runtime, model });
      results.push({ id: fixture.id, model: id, status: trace.status, failure: trace.firstFailure });
      stopped = trace.status !== 'PASS';
    }
  }
  if (!runtime) results.unshift({ status: 'INCOMPLETE', failure: 'RUNTIME_UNAVAILABLE' });
  const passed = results.filter(r => r.status === 'PASS').length;
  writeFileSync(join(out, 'cohort.json'), JSON.stringify({
    planned: 48, passed,
    status: results.some(r => r.status === 'FAIL') ? 'FAIL'
      : passed === 48 && results.length === 48 ? 'PASS' : 'INCOMPLETE',
  }, null, 2));
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(results, null, 2));
if (results.some(r => ['FAIL', 'INCOMPLETE', 'NOT_RUN'].includes(r.status))) process.exitCode = 1;

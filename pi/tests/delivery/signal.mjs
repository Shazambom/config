// Exercise the installed Bash tool's real AbortSignal/process-group path.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const [work] = process.argv.slice(2);
const { createBashToolDefinition } = await import(pathToFileURL(join(work, 'package/dist/core/tools/bash.js')));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const receipt = join(work, 'tool-interrupted.json');
const controller = new AbortController();
let observedReady = false;
const timer = setTimeout(() => controller.abort(), 15000);
try {
  await assert.rejects(createBashToolDefinition(work).execute('cancel-delivery', {
    command: `bash ${quote(join(work, 'repo/init.sh'))} --pi-delivery ${quote(receipt)}`,
  }, controller.signal, update => {
    if (update.content.some(part => part.type === 'text' && part.text.includes('DELIVERY_SIGNAL_READY'))) {
      observedReady = true;
      controller.abort();
    }
  }), /Command aborted/);
  assert(observedReady, 'abort only after actual setup readiness output');
  const record = JSON.parse(readFileSync(receipt));
  assert.equal(record.completion, 'not_observed');
  assert.equal(record.setup_exit, null);
  assert.equal(record.artifact_check.state, 'unknown');
  const pid = Number(readFileSync(join(work, 'tool-setup.pid'), 'utf8'));
  let exists;
  try { process.kill(pid, 0); exists = true; } catch (error) { assert.equal(error.code, 'ESRCH'); exists = false; }
  writeFileSync(join(work, 'tool-cancellation.json'), JSON.stringify({ aborted: true, observedReady, setupPid: pid, setupPidExistsAtObservation: exists, receipt }, null, 2));
  console.log('PASS: real Bash tool cancellation retains completion-not-observed receipt; no automatic retry');
} finally {
  clearTimeout(timer);
}

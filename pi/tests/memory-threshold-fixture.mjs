import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJiti } from 'jiti';

const pins = JSON.parse(readFileSync(new URL('../upstream.json', import.meta.url), 'utf8'));
const pin = pins.find(item => item.name === 'pi-observational-memory');
const root = new URL(`../upstream/${pin.name}-${pin.ref}/src/`, import.meta.url);
const jiti = createJiti(import.meta.url);
const { Runtime } = await jiti.import(new URL('runtime.ts', root).pathname);
const { registerCompactionTrigger } = await jiti.import(new URL('hooks/compaction-trigger.ts', root).pathname);
const runtime = new Runtime();
runtime.ensureConfig(process.cwd());
runtime.enabled = true;
let handler;
registerCompactionTrigger({ on: (_event, callback) => { handler = callback; } }, runtime);
let tokens = 349999;
let compactions = 0;
const ctx = {
  hasUI: false,
  getContextUsage: () => ({ tokens }),
  compact: ({ onComplete }) => { compactions++; onComplete(); },
};
const astra = { provider: 'openai-codex', id: 'gpt-6-astra' };
const fable = { provider: 'anthropic', id: 'claude-fable-5' };
runtime.mainModel = astra;
assert.equal(runtime.compactionThreshold, 350000);
handler({}, ctx);
assert.equal(compactions, 0);
tokens = 350000;
handler({}, ctx);
assert.equal(compactions, 1);
runtime.mainModel = fable;
assert.equal(runtime.compactionThreshold, 700000);
handler({}, ctx);
assert.equal(compactions, 1);
tokens = 700000;
handler({}, ctx);
assert.equal(compactions, 2);
runtime.mainModel = astra;
let gauges;
runtime.status.setGauges = value => { gauges = value; };
runtime.refreshFooterGauges([], 123);
assert.equal(gauges.ctxMax, 350000);
runtime.mainModel = undefined;
assert.equal(runtime.compactionThreshold, 700000);
console.log('PASS: Astra-only compaction boundary, Fable fallback, model switching and footer threshold');

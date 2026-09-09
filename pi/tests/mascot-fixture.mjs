import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { createJiti } from 'jiti';
import { visibleWidth } from '@earendil-works/pi-tui';

const source = readFileSync(new URL('../agent/extensions/mascot.ts', import.meta.url), 'utf8');
assert(!/[█▌━]/u.test(source), 'Keep mascot drawing glyphs escaped so source diffs remain readable');
const jiti = createJiti(import.meta.url);
const { default: mascot } = await jiti.import('../agent/extensions/mascot.ts');
const hooks = new Map();
const commands = new Map();
mascot({
  on: (event, handler) => hooks.set(event, handler),
  registerCommand: (name, command) => commands.set(name, command),
});
let header;
let input;
let renders = 0;
const ctx = {
  mode: 'tui',
  ui: {
    setHeader(factory) {
      header?.dispose();
      header = factory?.({ requestRender: () => renders++ }, { fg: (_color, text) => text });
    },
    onTerminalInput(handler) {
      input = handler;
      return () => { input = undefined; };
    },
  },
};
const savedAgent = process.env.PI_SUBAGENT_AGENT;
const savedWorker = process.env.OM_WORKER;
delete process.env.PI_SUBAGENT_AGENT;
delete process.env.OM_WORKER;
mock.timers.enable({ apis: ['setInterval'] });
try {
  for (const mode of ['rpc', 'print']) {
    hooks.get('session_start')({}, { ...ctx, mode });
    assert.equal(header, undefined);
  }
  for (const variable of ['PI_SUBAGENT_AGENT', 'OM_WORKER']) {
    process.env[variable] = 'fixture';
    hooks.get('session_start')({}, ctx);
    assert.equal(header, undefined);
    delete process.env[variable];
  }
  hooks.get('session_start')({}, ctx);
  assert(header);
  const first = header.render(80);
  mock.timers.tick(1000);
  const revealed = header.render(80);
  assert.notDeepEqual(first, revealed);
  assert.equal(first.length, revealed.length);
  assert(revealed.some(line => line.includes('██████████████')));
  assert(revealed.some(line => line.includes('█▌    █▌')));
  for (const width of [0, 1, 8, 16, 40, 80]) {
    assert(header.render(width).every(line => visibleWidth(line) <= width));
  }
  mock.timers.tick(3000);
  assert(header.render(80).some(line => line.includes('━━')));
  assert.equal(input('x'), undefined);
  assert.equal(input, undefined);
  const stoppedRenders = renders;
  mock.timers.tick(5000);
  assert.equal(renders, stoppedRenders);
  assert.deepEqual(header.render(80), revealed);
  await commands.get('mascot').handler('', ctx);
  assert(input);
  await commands.get('mascot').handler('off', ctx);
  assert.equal(header, undefined);
  assert.equal(input, undefined);
  const offRenders = renders;
  mock.timers.tick(5000);
  assert.equal(renders, offRenders);
  hooks.get('session_start')({}, ctx);
  const beforeReload = renders;
  hooks.get('session_start')({ reason: 'reload' }, ctx);
  mock.timers.tick(100);
  assert.equal(renders, beforeReload + 1);
  hooks.get('session_shutdown')({});
  const shutdownRenders = renders;
  mock.timers.tick(5000);
  assert.equal(renders, shutdownRenders);
  assert.equal(input, undefined);
  console.log('PASS: mascot reveal, blink, widths, input passthrough, headless guards and timer cleanup');
} finally {
  hooks.get('session_shutdown')({});
  mock.timers.reset();
  for (const [key, value] of [['PI_SUBAGENT_AGENT', savedAgent], ['OM_WORKER', savedWorker]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

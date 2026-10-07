// Exercise the actual deployed symlink target and picker, not a copied implementation.
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from '../../node_modules/jiti/lib/jiti.mjs';
const agent = join(process.env.CONFIG_PI_HOME, 'agent');
const target = join(agent, 'extensions/prompt-snippets/index.ts');
assert(lstatSync(target).isSymbolicLink(), 'setup must deploy the real extension symlink');
const expected = new Map([
  ['scope-creep', "Stay within the intended scope of the feature. Do not deviate or add features beyond its original intent. Focus on delivering the MVP, and expand scope only at the user's discretion. Follow TDD without using it as a reason to expand scope."],
  ['research-escape-hatch', "Use online research as an escape hatch when you've spent too long making little progress or tried many approaches without success. Search from several angles and levels of abstraction: the exact symptom, the underlying mechanism, and the broader problem. Look for existing solutions and other people's reasoning. Treat results as references and suggested paths, not authority. Verify promising ideas against the actual system and requirements; don't let them cloud your judgment, change the end goal, or expand scope. Never put secrets, private code, or internal data into searches."],
]);
for (const [name, body] of expected) assert(readFileSync(join(agent, `extensions/prompt-snippets/snippets/${name}.md`), 'utf8').includes(body));
const commands = new Map(), hooks = new Map();
(await createJiti(import.meta.url).import(target)).default({
  registerCommand: (name, handler) => commands.set(name, handler),
  registerShortcut() {}, on: (name, handler) => hooks.set(name, handler),
});
let component;
const theme = { fg: (_color, text) => text, bold: text => text };
const ctx = { hasUI: true, mode: 'tui', ui: { theme, notify: text => assert.fail(text), setWidget() {},
  custom: factory => new Promise(done => { component = factory({ terminal: { rows: 40 }, requestRender() {} }, theme, {}, done); }),
} };
await hooks.get('session_start')({}, ctx);
const opened = commands.get('snippets').handler('', ctx);
const found = new Set();
const visited = new Set();
for (let i = 0; i < 100; i++) {
  const cursor = component.render(160).find(line => line.startsWith('> '));
  assert(cursor, 'picker has a selected row');
  const name = [...expected.keys()].find(name => cursor.includes(name));
  if (name && !found.has(name)) { component.handleInput(' '); found.add(name); }
  if (found.size === expected.size || visited.has(cursor)) break;
  visited.add(cursor); component.handleInput('j');
}
assert.deepEqual([...found].sort(), [...expected.keys()].sort(), 'picker actually loads both deployed snippets');
component.handleInput('\r'); await opened;
const result = await hooks.get('input')({ text: 'DEPLOYMENT_INPUT', source: 'interactive' }, ctx);
assert.equal(result.action, 'transform');
assert.equal(result.text.trim(), `DEPLOYMENT_INPUT\n\n${[...expected.values()].join('\n\n')}`);
assert.equal(await hooks.get('input')({ text: 'SECOND_INPUT', source: 'interactive' }, ctx), undefined, 'one-shot selection resets');
console.log('PASS: direct Jiti deployed picker selects scope-creep and research-escape-hatch, appends exact bodies in order, resets');

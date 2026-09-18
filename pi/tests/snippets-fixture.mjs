import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';

const commands = new Map();
const shortcuts = new Map();
const hooks = new Map();
const extension = await createJiti(import.meta.url).import(join(process.env.CONFIG_PI_HOME ?? join(homedir(), '.pi'), 'agent/extensions/prompt-snippets/index.ts'));
extension.default({
  registerCommand: (name, command) => commands.set(name, command),
  registerShortcut: (key, shortcut) => shortcuts.set(key, shortcut),
  on: (name, handler) => hooks.set(name, handler),
});
let component;
let widget;
let redraws = 0;
const theme = { fg: (_color, text) => text, bold: text => text };
const ctx = {
  hasUI: true, mode: 'tui',
  ui: {
    theme,
    notify: message => assert.fail(message),
    setWidget: (_name, value) => { widget = value; },
    custom: factory => new Promise(done => {
      component = factory({ terminal: { rows: 15 }, requestRender: () => { redraws++; } }, theme, {}, done);
    }),
  },
};
const frame = (width = 120) => component.render(width).join('\n');
const cursor = () => component.render(120).find(line => line.startsWith('> ')).slice(2);
const press = key => { component.handleInput(key); return frame(); };
hooks.get('session_start')({}, ctx);
const opened = commands.get('snippets').handler('', ctx);
assert(frame().includes('j/k or ↑↓ navigate'));
const first = cursor();
press('j');
const second = cursor();
assert.notEqual(second, first);
press('k');
assert.equal(cursor(), first);
press('k');
assert.notEqual(cursor(), first);
press('j');
assert.equal(cursor(), first, 'j wraps from last to first');
press('\x1b[B');
assert.equal(cursor(), second);
press('\x1b[A');
assert.equal(cursor(), first);
press('\x1b[106u');
assert.equal(cursor(), second, 'Kitty-encoded j');
press('\x1b[107u');
assert.equal(cursor(), first, 'Kitty-encoded k');
press(' ');
assert(cursor().startsWith('[x]'));
press(' ');
assert(cursor().startsWith('[ ]'));
press('\t');
const preview = frame(40);
component.handleInput('j');
assert.notEqual(frame(40), preview, 'j scrolls preview');
component.handleInput('k');
assert.equal(frame(40), preview, 'k scrolls preview back');
press('\x1b');
assert.equal(cursor(), first);
press('j');
press(' ');
press('\r');
await opened;
assert(widget?.length, 'Enter applies selection');
const transformed = await hooks.get('input')({ text: 'USER_PROMPT' }, ctx);
assert.equal(transformed.action, 'transform');
assert(transformed.text.includes('USER_PROMPT'));
assert(transformed.text.length > 'USER_PROMPT'.length, 'Selected snippet reaches actual input transform');
assert.equal(widget, undefined, 'Selection resets after send');
const cancelled = shortcuts.get('ctrl+r').handler(ctx);
press(' ');
press('\x1b');
await cancelled;
assert.equal(await hooks.get('input')({ text: 'UNCHANGED' }, ctx), undefined, 'Esc discards selection');
assert(redraws > 0);
console.log('PASS: deployed snippet picker j/k, arrows, Kitty keys, wraparound, preview scrolling, Space toggle, Enter apply, input transformation and Esc cancellation.');

import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const VIEWPORT_TUI = Symbol.for('@earendil-works/pi-tui/viewport');
const jiti = createJiti(import.meta.url);
const { openReview } = await jiti.import('../overrides/diff-ui.ts');
class Base { render() { return ['live transcript']; } }
class TuiMainScreen extends Base {
  terminal = { rows: 8, columns: 40 };
  requestRender() {}
}
function dialog(tui) {
  let close, reject;
  const warnings = [];
  const ctx = { ui: {
    notify: message => warnings.push(message),
    custom(factory, options) {
      assert.deepEqual(options, { overlay: true, overlayOptions: { anchor: 'top-left', width: '100%', maxHeight: '100%' } });
      return new Promise((resolve, fail) => {
        close = resolve;
        reject = fail;
        factory(tui, {}, {}, resolve);
      });
    },
  } };
  return { ctx, warnings, close: value => close(value), reject: error => reject(error) };
}
const factory = () => ({ render: () => ['diff'], invalidate() {} });
for (const own of [false, true]) {
  const tui = new TuiMainScreen();
  if (own) Object.defineProperty(tui, 'render', { value: () => ['own live'], configurable: true, enumerable: true, writable: false });
  const original = Object.getOwnPropertyDescriptor(tui, 'render');
  const originalRender = tui.render;
  const first = dialog(tui);
  const pending = openReview(first.ctx, factory);
  assert.deepEqual(tui.render(), Array(8).fill(''));
  tui.terminal.rows = 2;
  assert.equal(tui.render().length, 2);
  const second = dialog(tui);
  const nested = openReview(second.ctx, factory);
  first.close('cancel');
  assert.equal(await pending, 'cancel');
  assert.equal(tui.render().length, 2);
  second.close('submit');
  assert.equal(await nested, 'submit');
  assert.equal(tui.render, originalRender);
  assert.deepEqual(Object.getOwnPropertyDescriptor(tui, 'render'), original);
}
{
  const tui = new TuiMainScreen();
  const original = tui.render;
  const test = dialog(tui);
  const pending = openReview(test.ctx, factory);
  test.reject(new Error('mount failed'));
  await assert.rejects(pending, /mount failed/);
  assert.equal(tui.render, original);
  assert(!Object.hasOwn(tui, 'render'));
  const thrown = dialog(tui);
  await assert.rejects(openReview(thrown.ctx, () => { throw new Error('factory failed'); }), /factory failed/);
  assert.equal(tui.render, original);
}
{
  const tui = new TuiMainScreen();
  const test = dialog(tui);
  const pending = openReview(test.ctx, factory);
  const later = () => ['another extension'];
  tui.render = later;
  test.close();
  await pending;
  assert.equal(tui.render, later);
}
for (const fullscreen of [false, true]) {
  const tui = new Base();
  if (fullscreen) tui[VIEWPORT_TUI] = true;
  const original = tui.render;
  const test = dialog(tui);
  const pending = openReview(test.ctx, factory);
  assert.equal(tui.render, original);
  assert.equal(test.warnings.length, fullscreen ? 0 : 1);
  test.close();
  await pending;
}
console.log('Diff UI lifecycle checks passed');

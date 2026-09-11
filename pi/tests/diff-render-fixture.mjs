import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createJiti } from 'jiti';
import { pathToFileURL } from 'node:url';
const agentRoot = process.env.DIFF_TEST_PI;
const agentModule = path => agentRoot ? pathToFileURL(`${agentRoot}/${path}`).href : new URL(`../node_modules/@earendil-works/pi-coding-agent/${path}`, import.meta.url).href;
const { Container, ProcessTerminal, TuiMainScreen, TuiAltScreen, visibleWidth } = await import(agentRoot ? pathToFileURL(`${agentRoot}/node_modules/@earendil-works/pi-tui/dist/index.js`).href : '@earendil-works/pi-tui');
const { setTheme } = await import(agentModule('dist/modes/interactive/theme/theme.js'));
const { InteractiveMode } = await import(agentModule('dist/modes/interactive/interactive-mode.js'));

// Exercise Pi's actual custom-UI lifecycle and renderer without an agent or credentials.
const [resultPath, mode = 'check'] = process.argv.slice(2);
const jiti = createJiti(import.meta.url);
const { ReviewComponent } = await jiti.import(process.env.DIFF_TEST_COMPONENT);
const indexPath = new URL('../index.ts', pathToFileURL(process.env.DIFF_TEST_COMPONENT));
const { registerDiffReviewCommand, registerViewCommand } = await jiti.import(indexPath.href);
const commands = new Map();
const api = { registerCommand: (name, command) => commands.set(name, command) };
registerDiffReviewCommand(api);
registerViewCommand(api);
assert(commands.has('diff') && commands.has('view'));
const { parseDiff } = await jiti.import('../node_modules/pi-diff-review/src/diff/parser.ts');
setTheme('dark');
const diff = ['first', 'second'].map(name => `diff --git a/${name}.ts b/${name}.ts\n--- a/${name}.ts\n+++ b/${name}.ts\n@@ -1,40 +1,40 @@\n` + Array.from({ length: 40 }, (_, i) => `-const old${i} = ${i};\n+const new${i} = ${i}; // ${'long '.repeat(30)}\n`).join('')).join('');
const terminal = new ProcessTerminal();
const fullscreen = process.env.DIFF_TEST_FULLSCREEN === '1';
const tui = fullscreen ? new TuiAltScreen(terminal) : new TuiMainScreen(terminal);
let output = '';
const write = terminal.write.bind(terminal);
terminal.write = data => { output += data; write(data); };
let transcript = Array.from({ length: 35 }, (_, i) => `fixture transcript ${i}`);
let status = ['fixture status idle'];
const editor = { render: () => ['fixture editor'], invalidate() {}, getText: () => 'draft', setText: value => assert.equal(value, 'draft') };
const editorContainer = new Container();
editorContainer.addChild(editor);
tui.addChild({ render: () => transcript, invalidate() {} });
tui.addChild(editorContainer);
tui.addChild({ render: () => status, invalidate() {} });
tui.setFocus(editor);
const host = { ui: tui, editor, editorContainer, disposeActiveSelector() {} };
const settle = () => new Promise(resolve => setTimeout(resolve, 100));
const tmux = (...args) => execFileSync('tmux', ['-S', process.env.DIFF_TEST_SOCKET, ...args], { encoding: 'utf8' });
const screen = () => tmux('capture-pane', '-p', '-t', process.env.TMUX_PANE);
const { openReview } = await jiti.import('../overrides/diff-ui.ts');
const ctx = { ui: { custom: (factory, options) => InteractiveMode.prototype.showExtensionCustom.call(host, factory, options), notify: message => { throw new Error(message); } } };
const measurements = [];
let component;
const open = () => {
  const factory = (ui, currentTheme, _keys, done) => {
    component = new ReviewComponent(ui, currentTheme, 'Render fixture', parseDiff(diff), new Map(), done);
    return component;
  };
  return mode === 'baseline' ? ctx.ui.custom(factory) : openReview(ctx, factory);
};
async function stream(label) {
  const before = screen();
  output = '';
  for (let i = 0; i < 8; i++) {
    // Grow and rewrite an earlier line, as streaming Markdown/tool output does.
    transcript[transcript.length - 1] = `fixture streamed token ${label} ${i}`;
    transcript.push(`fixture stream ${label} ${i}`);
    status = Array.from({ length: i % 3 + 1 }, (_, row) => `fixture status ${label} ${i} ${row}`);
    tui.requestRender();
    await settle();
    if (mode !== 'baseline') assert.equal(screen(), before, `stream moved review: ${label}/${i}`);
  }
  const clears = (output.match(/\x1b\[(?:2|3)J/g) ?? []).length;
  measurements.push({ label, clears, bytes: Buffer.byteLength(output), changed: screen() !== before });
  if (mode !== 'baseline') {
    assert.equal(clears, 0, label);
    assert(!screen().includes('fixture stream'));
    assert(!screen().includes('fixture status'));
  }
}
try {
  tui.start();
  await settle();
  const flags = tmux('display-message', '-p', '-t', process.env.TMUX_PANE, '#{alternate_on} #{mouse_any_flag} #{pane_in_mode}').trim();
  assert.equal(flags, fullscreen ? '1 1 0' : '0 0 0');
  const lower = mode === 'baseline' ? undefined : tui.showOverlay({
    render: () => [`fixture lower ${transcript.length}`], invalidate() {},
  }, { width: 30, nonCapturing: true });
  let closed = open();
  await settle();
  await stream('idle review');
  if (mode !== 'baseline') {
    for (const key of ['j', ']', '[', 'h', 'h', 't', 'v', 'w', 'f', 'f', 's', '?', '?', 'a', '\x1b', 'c']) {
      component.handleInput(key);
      await settle();
      assert(component.render(terminal.columns).every(line => visibleWidth(line) <= terminal.columns));
      await stream(`key ${key}`);
    }
    component.handleInput('note');
    component.handleInput('\r');
    await settle();
    await stream('saved comment');
    component.handleInput('\r');
    assert.equal((await closed).action, 'submit');
    await settle();
    assert(screen().includes('fixture stream saved comment 7'));
    assert(screen().includes(`fixture lower ${transcript.length}`));
    // Esc and q both dispose the overlay without cancelling background updates.
    for (const exit of ['\x1b', 'q']) {
      closed = open();
      await settle();
      component.handleInput(exit);
      assert.equal((await closed).action, 'cancel');
      await settle();
      assert(screen().includes('fixture stream saved comment 7'));
    }
    closed = open();
    await settle();
    lower.setHidden(true);
    await settle();
    await stream('inactive underlying overlay');
    for (const [columns, rows] of [[65, 14], [35, 6], [8, 3], [8, 2], [8, 1], [120, 35]]) {
      tmux('resize-window', '-t', 'fixture', '-x', String(columns), '-y', String(rows));
      await settle();
      assert.equal(component.render(terminal.columns).length, terminal.rows);
      assert(component.render(terminal.columns).every(line => visibleWidth(line) <= terminal.columns));
      await stream(`resize ${columns}x${rows}`);
    }
    component.handleInput('q');
    await closed;
    lower.hide();
  } else {
    assert(measurements.some(item => item.clears > 0 && item.changed), 'baseline did not reproduce flashing/jumping');
    component.handleInput('q');
    await closed;
  }
  writeFileSync(resultPath, JSON.stringify({ flags, measurements }, null, 2));
} catch (error) {
  appendFileSync(resultPath + '.error', error.stack + '\n');
  process.exitCode = 1;
} finally {
  tui.stop();
}

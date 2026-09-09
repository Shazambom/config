import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJiti } from 'jiti';
import { setTheme, theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import { visibleWidth } from '@earendil-works/pi-tui';

assert.deepEqual(setTheme('jetbrains-dark'), { success: true });
const jiti = createJiti(import.meta.url);
const { ReviewComponent } = await jiti.import('../node_modules/pi-diff-review/src/review/component.ts');
const { parseDiff } = await jiti.import('../node_modules/pi-diff-review/src/diff/parser.ts');
const mascotBar = readFileSync(new URL('../agent/extensions/mascot.ts', import.meta.url), 'utf8')
  .split('\n').find(line => line.includes('.repeat(14)'));
assert(mascotBar?.includes('\\u2588'));
assert(!mascotBar.includes('█'));
const lines = parseDiff('diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1,2 +1,3 @@\n-const oldValue = "removed";\n+const newValue = "added";\n+' + mascotBar + '\n const unchanged = true;\n');
const component = new ReviewComponent(
  { requestRender() {}, terminal: { rows: 40, columns: 180 } },
  theme, 'Color fixture', lines, new Map(), () => {},
);
const index = lines.findIndex(line => line.kind === 'remove');
assert(index >= 0);
const removed = lines[index];
const text = component.getDisplayText(removed);
assert.equal(component.getRenderedDiffContent(removed, index), theme.fg('toolDiffRemoved', text));
assert.equal(component.getLineMark(removed, index), '−');
const addedIndex = lines.findIndex(line => line.kind === 'add');
const added = lines[addedIndex];
assert.equal(component.getLineMark(added, addedIndex), '+');
assert.equal(component.getRenderedDiffContent(added, addedIndex),
  theme.fg('toolDiffAdded', component.getDisplayText(added)));
assert(component.applyReviewedBackground('reviewed', 60).startsWith('\x1b[48;2;38;68;46m'));
assert.equal(theme.getFgAnsi('toolDiffAdded'), '\x1b[38;2;175;245;180m');
assert.equal(theme.getBgAnsi('toolSuccessBg'), theme.getBgAnsi('toolPendingBg'));
assert(component.applyDiffBackground(added, 'added', 60).startsWith('\x1b[48;2;3;58;22m'));
assert.equal(theme.getFgAnsi('toolDiffRemoved'), '\x1b[38;2;255;220;215m');
assert.equal(theme.getBgAnsi('toolErrorBg'), theme.getBgAnsi('toolPendingBg'));
const barIndex = lines.findIndex(line => line.kind === 'add' && line.text.includes('.repeat(14)'));
assert(barIndex >= 0);
assert.equal(component.getRenderedDiffContent(lines[barIndex], barIndex), theme.fg('toolDiffAdded', mascotBar));
const redBackground = '\x1b[48;2;103;6;12m';
assert.notEqual(redBackground, theme.getBgAnsi('toolPendingBg'));
assert(component.applyDiffBackground(removed, text, 60).startsWith(redBackground));
for (const width of [60, 180]) {
  const rendered = component.render(width);
  assert(rendered.some(line => line.includes(theme.getFgAnsi('toolDiffRemoved')) && line.includes('oldValue')));
  assert(rendered.some(line => line.includes(theme.getFgAnsi('toolDiffAdded')) && line.includes('newValue')));
  assert(rendered.every(line => visibleWidth(line) <= width));
}
const glyphSource = 'const glyphs = "█▌━━"; const after = 1;';
const glyphLines = parseDiff('diff --git a/glyphs.ts b/glyphs.ts\n--- a/glyphs.ts\n+++ b/glyphs.ts\n@@ -1 +1 @@\n-' + glyphSource + '\n+' + glyphSource + '\n');
const glyphComponent = new ReviewComponent(
  { requestRender() {}, terminal: { rows: 40, columns: 180 } },
  theme, 'Glyph fixture', glyphLines, new Map(), () => {},
);
const glyphIndex = glyphLines.findIndex(line => line.kind === 'add');
const glyphLine = glyphLines[glyphIndex];
const readable = 'const glyphs = "\\u2588\\u258c\\u2501\\u2501"; const after = 1;';
assert.equal(glyphComponent.getDisplayText(glyphLine), readable);
assert.equal(glyphLine.text, '+' + glyphSource);
for (const width of [60, 180]) {
  const rendered = glyphComponent.render(width);
  assert(!rendered.some(line => /[█▌━]/u.test(line)));
  assert(rendered.every(line => visibleWidth(line) <= width));
}
glyphComponent.search.query = 'after';
const searched = glyphComponent.getRenderedDiffContent(glyphLine, glyphIndex);
assert(searched.includes(theme.fg('warning', 'after')) || searched.includes(theme.fg('accent', 'after')));
assert.equal(searched.replace(/\x1b\[[0-9;]*m/g, ''), readable);
glyphComponent.search.query = '█';
assert(glyphComponent.getRenderedDiffContent(glyphLine, glyphIndex).includes('\\u2588'));
component.getSearchHighlightedDisplayText = () => 'search highlight';
assert.equal(component.getRenderedDiffContent(removed, index), 'search highlight');
assert.equal(component.getRenderedDiffContent(added, addedIndex), 'search highlight');
console.log('PASS: added/removed foregrounds, green reviewed overlay, explicit markers, narrow/wide rendering, escaped glyphs and search preservation');

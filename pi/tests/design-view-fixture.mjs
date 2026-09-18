import assert from 'node:assert/strict';
import { writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import { getLanguageFromPath } from '@earendil-works/pi-coding-agent';
import { setTheme, theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import { visibleWidth } from '@earendil-works/pi-tui';

const root = realpathSync(process.argv[2]);
assert.deepEqual(setTheme('jetbrains-dark'), { success: true });
const jiti = createJiti(import.meta.url);
const { ReviewComponent } = await jiti.import('../node_modules/pi-diff-review/src/review/component.ts');
const { parseViewSource, resolveViewFiles } = await jiti.import('../node_modules/pi-diff-review/src/view/source.ts');
const { parseViewFiles } = await jiti.import('../node_modules/pi-diff-review/src/view/parser.ts');
const results = [];
for (const [language, extension, declaration] of [
  ['go', 'go', 'type OrderReceipt struct'],
  ['python', 'py', 'class OrderReceipt(NamedTuple)'],
  ['rust', 'rs', 'pub struct OrderReceipt'],
]) {
  const filename = path.join(root, language, `design.${extension}`);
  const source = parseViewSource(`'${filename.replaceAll("'", "'\\''")}'`);
  const files = resolveViewFiles(root, source);
  assert.deepEqual(files.map(file => realpathSync(file)), [filename]);
  assert.equal(getLanguageFromPath(filename), language);
  const lines = parseViewFiles(root, files);
  const component = new ReviewComponent(
    { requestRender() {}, terminal: { rows: 200, columns: 180 } },
    theme, `Design ${language}`, lines, new Map(), () => {},
  );
  const index = lines.findIndex(line => line.text.includes(declaration));
  assert(index >= 0);
  const colored = component.getRenderedDiffContent(lines[index], index);
  assert(colored.includes(theme.getFgAnsi('syntaxKeyword')), `${language}: missing keyword color`);
  assert(colored.includes('OrderReceipt'));
  assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ''), component.getDisplayText(lines[index]));
  const rendered = component.render(180);
  assert(rendered.every(line => visibleWidth(line) <= 180));
  assert(rendered.some(line => line.includes('OrderReceipt') && line.includes(theme.getFgAnsi('syntaxKeyword'))));
  writeFileSync(path.join(root, language, 'view.ansi'), rendered.join('\n') + '\n');
  results.push({ language, filename, resolvedFiles: files, declaration: colored, renderedLines: rendered.length, passed: true });
}
writeFileSync(path.join(root, 'view.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`PASS: real /view resolution, parsing and colored ReviewComponent rendering for Go/Python/Rust; ${root}/view.json`);

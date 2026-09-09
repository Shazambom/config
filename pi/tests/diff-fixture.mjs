import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { parseDiffSource, getDiff } = await jiti.import('../node_modules/pi-diff-review/src/diff/source.ts');
const { parseDiff } = await jiti.import('../node_modules/pi-diff-review/src/diff/parser.ts');
const source = parseDiffSource(process.argv[3] ?? '');
const text = getDiff(process.argv[2], source);
process.stdout.write(JSON.stringify({ source, text, lines: parseDiff(text) }));

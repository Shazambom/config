import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
globalThis.fetch = async () => { throw new Error('Width fixture blocks network'); };
const before = await import(pathToFileURL(process.argv[2]));
const after = await import(pathToFileURL(process.argv[3]));
const samples = ['', 'plain text', '\t', '漢字', 'e\u0301', '👩‍💻', '⚠️', '\u200d', '\n', '\r', '\x1b[31mhello\x1b[0m', '\x1b]8;;https://example.com\x07link\x1b]8;;\x07', '\x1b_cursor\x1b\\'];
for (let n=0; n<2000; n++) {
  const text = `case${n} ` + samples[n%samples.length] + '\x1b[32m' + samples[(n*7+3)%samples.length] + '\x1b[0m';
  assert.equal(after.visibleWidth(text), before.visibleWidth(text), JSON.stringify(text));
}
assert.equal(after.visibleWidth('\x1b[31mhello\x1b[0m'), 5);
assert.equal(after.visibleWidth('\t'), 3);
assert.equal(after.visibleWidth('漢字'), 4);
// Count expensive segmentation directly; no timing threshold or mocked width result.
const segment = Intl.Segmenter.prototype.segment;
let calls = 0;
Intl.Segmenter.prototype.segment = function (...args) { calls++; return segment.apply(this,args); };
try {
  for (let n=0;n<1000;n++) before.visibleWidth(`\x1b[31mbenchmark-${n} ${'text '.repeat(30)}\x1b[0m`);
  assert(calls >= 1000, 'Negative control must enter Unicode segmentation');
  calls=0;
  for (let n=0;n<1000;n++) after.visibleWidth(`\x1b[31mbenchmark-${n} ${'text '.repeat(30)}\x1b[0m`);
  assert.equal(calls,0,'Styled printable ASCII must skip Unicode segmentation');
  after.visibleWidth('Unicode fallback 漢字 e\u0301 👩‍💻');
  assert(calls>0,'Unicode must retain the native segmenter');
} finally { Intl.Segmenter.prototype.segment=segment; }
console.log('PASS: 2000 native-bundle width comparisons; styled ASCII avoids segmentation; Unicode fallback retained.');

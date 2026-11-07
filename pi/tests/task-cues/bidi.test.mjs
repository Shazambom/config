import test from 'node:test';
import assert from 'node:assert/strict';
import { scalar, cueText } from '../../agent/task-cues/observations.mjs';

// Explicit Unicode Bidi_Control set, independent of the implementation's regex.
const bidiControls = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c,
  0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const escaped = code => '\\u' + code.toString(16).padStart(4, '0');
const progress = value => cueText({ lastResult: { source: 'saved', data: {
  tool_name: value, tool_call_id: value, reported_error: false,
}}, outcome: 'recorded-results-only', unresolved: 0, gaps: [], paired: 1 });

for (const code of bidiControls) {
  const character = String.fromCodePoint(code);
  for (const [name, render] of [['scalar', scalar], ['progress', progress]]) {
    test(`${name} escapes Bidi_Control U+${code.toString(16).toUpperCase()}`, () => {
      const output = render(`left${character}right`);
      assert(!output.includes(character), `raw Bidi_Control ${escaped(code)} must not survive ${name}`);
      assert(output.includes(`left${escaped(code)}right`), 'retain visible escaped identity');
      if (name === 'progress') assert.equal(output.split(`left${escaped(code)}right`).length - 1, 2,
        'escape both tool name and call ID');
    });
  }
}

test('retain existing control and line separator escaping', () => {
  for (const code of [0, 9, 10, 13, 0x1f, 0x7f, 0x85, 0x9f, 0x2028, 0x2029]) {
    const character = String.fromCodePoint(code);
    const expected = new Map([[9, '\\t'], [10, '\\n'], [13, '\\r']]).get(code) ?? escaped(code);
    const value = `left${character}right`;
    assert(!scalar(value).includes(character));
    assert(scalar(value).includes(expected));
    // The cue has intentional structural newlines; examine only the progress line.
    const line = progress(value).split('\n').find(line => line.startsWith('Progress:'));
    assert(!line.includes(character));
    assert(line.includes(expected));
  }
});

test('preserve ordinary Unicode and explicit bounded truncation', () => {
  const ordinary = 'café 中文 العربية 😀';
  assert.equal(scalar(ordinary), JSON.stringify(ordinary));
  assert(progress(ordinary).includes(ordinary));
  const output = progress('😀'.repeat(2000));
  assert(output.includes('…'));
  assert(Array.from(output).length <= 1200);
});

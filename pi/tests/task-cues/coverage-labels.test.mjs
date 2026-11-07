import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalEntries, project, cueText, observationType } from '../../agent/task-cues/observations.mjs';

const call = { type: 'message', id: 'call', message: { role: 'assistant', content: [
  { type: 'toolCall', id: 'old-call', name: 'write', arguments: { path: 'old.txt' } },
] } };
const result = { type: 'message', id: 'result', message: {
  role: 'toolResult', toolCallId: 'old-call', toolName: 'write', isError: false,
  content: [{ type: 'text', text: 'historical write reported success' }],
} };
const attempt = id => ({ type: 'custom', customType: observationType, id, data: {
  session_id: 'old-session', tool_call_id: 'old-call', parent_tool_call_id: null,
  phase: 'attempted', tool_name: 'write', attempted_target: null, reported_error: null,
} });
const observedResult = { ...attempt('observed-result'), data: {
  ...attempt('unused').data, phase: 'reported-result', reported_error: false,
} };
function withCanonical(entries, run) {
  const directory = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.coverage-labels-'));
  try {
    const path = join(directory, 'old.jsonl');
    writeFileSync(path, [{ type: 'session', version: 3, id: 'old-session' }, ...entries].map(JSON.stringify).join('\n') + '\n');
    run(canonicalEntries(path, 'old-session'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('complete historical canonical pair is unknown coverage, not an unfinished-work claim', () => {
  withCanonical([call, result], canonical => {
    const projection = project([call, result], canonical, 'old-session');
    assert.equal(projection.outcome, 'unknown');
    assert.equal(projection.unresolved, 1);
    assert.equal(projection.lastResult, undefined, 'do not invent task-cue result observations');
    assert(projection.gaps.includes('top-level transcript observation coverage gap'));
    const cue = cueText(projection);
    assert(cue.includes('Progress: no task-cue result observations recorded'));
    assert(cue.includes('explicit unresolved observation identities=1'));
    assert(cue.includes('Missing instrumentation does not mean work is unfinished.'));
    assert(!cue.includes('Progress: none recorded'));
    assert(!cue.includes('; unresolved='));
  });
});

test('call-only, repeated attempts and live-only evidence retain conservative facts and provenance', () => {
  withCanonical([call], canonical => {
    const callOnly = project([call], canonical, 'old-session');
    assert.equal(callOnly.outcome, 'unknown');
    assert.equal(callOnly.unresolved, 1);
    const repeated = project([attempt('one'), attempt('two'), observedResult], canonical, 'old-session');
    assert.equal(repeated.unresolved, 1);
    assert.equal(repeated.paired, 0);
    assert(repeated.gaps.includes('repeated operation identity'));
    const live = project([attempt('one'), observedResult], canonical, 'old-session');
    assert.equal(live.outcome, 'unknown');
    assert.equal(live.paired, 1);
    assert.equal(live.lastResult.source, 'live-only');
    assert(cueText(live).includes('reported success / live-only'));
    const interrupted = project([attempt('one')], canonical, 'old-session');
    assert.equal(interrupted.unresolved, 1);
    assert(cueText(interrupted).includes('explicit unresolved observation identities=1'));
  });
});

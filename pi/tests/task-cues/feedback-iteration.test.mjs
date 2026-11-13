import test from 'node:test';
import assert from 'node:assert/strict';
import { cueText, project, observationType } from '../../agent/task-cues/observations.mjs';

const observation = (phase, id) => ({ type: 'custom', customType: observationType, id, data: {
  session_id: 's', tool_call_id: 'orphan', parent_tool_call_id: null, phase,
  tool_name: 'write', attempted_target: null, reported_error: phase === 'attempted' ? null : false,
} });
const saved = entries => ({ entries: new Map(entries.map(entry => [entry.id, entry])), gaps: new Set() });
const projection = gaps => ({ lastResult: undefined, outcome: 'unknown', unresolved: 0,
  unmatchedObservations: 0, gaps, paired: 0 });

const legitimateGaps = [
  'partial canonical file', 'unknown canonical session schema', 'malformed canonical entry',
  'conflicting canonical entry ID', 'canonical save unavailable', 'malformed live observation',
  'observation save uncertain', 'missing branch entry identity', 'conflicting branch entry ID',
  'malformed transcript call', 'transcript tool-name mismatch', 'malformed transcript result',
  'nested transcript coverage differs from execution observations',
  'unknown observation schema or session identity', 'repeated operation identity',
  'observation tool-name mismatch', 'top-level transcript observation coverage gap',
  'no operation observations',
];

test('orphan result is one unmatched or ambiguous observation group', () => {
  const entries = [observation('reported-result', 'result')];
  const facts = project(entries, saved(entries), 's');
  assert.equal(facts.unresolved, 1);
  assert.equal(facts.unmatchedObservations, 1);
  assert(cueText(facts).includes('unmatched/ambiguous observation groups=1'));
});

test('wording restores scope, gap label and investigate-before-replay warning', () => {
  const cue = cueText(projection([]));
  assert.equal(cue.split('\n').length, 3);
  assert(cue.includes('Current branch only'));
  assert(cue.includes('coverage gaps=none'));
  assert(cue.includes('uninstrumented history is not recovered'));
  assert(cue.includes('Investigate uncertain effects before replay'));
  assert(!cue.includes('may be legacy history'));
});

test('all legitimate gaps fit and verbose input is bounded with explicit omission', () => {
  const maximumFacts = projection(legitimateGaps);
  maximumFacts.lastResult = { source: 'live-only', data: {
    tool_name: '💥'.repeat(1000), tool_call_id: '💥'.repeat(1000), reported_error: true,
  } };
  const maximum = cueText(maximumFacts);
  for (const gap of legitimateGaps) assert(maximum.includes(gap), `retain legitimate gap: ${gap}`);
  assert(Array.from(maximum).length <= 1200);

  const verbose = cueText(projection(Array.from({ length: 100 }, (_, index) => `synthetic verbose gap ${index} ${'x'.repeat(80)}`)));
  assert(Array.from(verbose).length <= 1200);
  assert(verbose.includes('additional gaps omitted'));
});

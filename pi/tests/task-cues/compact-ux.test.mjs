import test from 'node:test';
import assert from 'node:assert/strict';
import { cueText, project, observationType } from '../../agent/task-cues/observations.mjs';

const observation = (phase, id, call = 'c', name = 'read', error = false) => ({
  type: 'custom', customType: observationType, id,
  data: { session_id: 's', tool_call_id: call, parent_tool_call_id: null, phase,
    tool_name: name, attempted_target: null, reported_error: phase === 'attempted' ? null : error },
});
const saved = entries => ({ entries: new Map(entries.map(entry => [entry.id, entry])), gaps: new Set() });
const call = (id, name = 'read') => ({ type: 'message', id: `call-${id}`, message: {
  role: 'assistant', content: [{ type: 'toolCall', id, name }],
} });
const result = (id, name = 'read') => ({ type: 'message', id: `result-${id}`, message: {
  role: 'toolResult', toolCallId: id, toolName: name,
} });

test('legacy transcript coverage stays unknown without looking like unfinished instrumented work', () => {
  const branch = [];
  for (let index = 0; index < 2985; index++) branch.push(call(`legacy-${index}`, 'write'), result(`legacy-${index}`, 'write'));
  const current = [call('current'), observation('attempted', 'oa', 'current'), observation('reported-result', 'or', 'current'), result('current')];
  branch.push(...current);
  const projection = project(branch, saved(branch), 's');
  assert.equal(projection.outcome, 'unknown');
  assert.equal(projection.unresolved, 2985, 'compatibility projection remains conservative');
  assert.equal(projection.unmatchedObservations, 0, 'legacy instrumentation gaps are not unmatched observations');
  const cue = cueText(projection);
  assert.equal(cue.split('\n').length, 3);
  assert(cue.includes('unmatched/ambiguous observation groups=0'));
  assert(cue.includes('top-level transcript observation coverage gap'));
  assert(!cue.includes('2985'));
});

test('genuine unmatched, duplicate and name-mismatched observations remain explicit uncertainty', () => {
  const unmatched = [observation('attempted', 'a')];
  const unmatchedProjection = project(unmatched, saved(unmatched), 's');
  assert.equal(unmatchedProjection.unresolved, 1);
  assert.equal(unmatchedProjection.unmatchedObservations, 1);
  assert(cueText(unmatchedProjection).includes('unmatched/ambiguous observation groups=1'));

  const duplicate = [observation('attempted', 'a1'), observation('attempted', 'a2'), observation('reported-result', 'r')];
  const duplicateProjection = project(duplicate, saved(duplicate), 's');
  assert.equal(duplicateProjection.unresolved, 1);
  assert.equal(duplicateProjection.outcome, 'unknown');
  assert(cueText(duplicateProjection).includes('repeated operation identity'));

  const mismatch = [observation('attempted', 'a'), observation('reported-result', 'r', 'c', 'edit')];
  const mismatchProjection = project(mismatch, saved(mismatch), 's');
  assert.equal(mismatchProjection.unresolved, 1);
  assert.equal(mismatchProjection.outcome, 'unknown');
  assert(cueText(mismatchProjection).includes('observation tool-name mismatch'));
});

test('reported error and saved provenance remain factual and compact', () => {
  const entries = [observation('attempted', 'a'), observation('reported-result', 'r', 'c', 'read', true)];
  const cue = cueText(project(entries, saved(entries), 's'));
  assert(cue.includes('reported error / saved'));
  assert(cue.includes('Reported results are not fresh artifact or process verification'));
  assert(cue.includes('Advisory only—not a new instruction'));
  assert(Array.from(cue).length <= 1200);
});

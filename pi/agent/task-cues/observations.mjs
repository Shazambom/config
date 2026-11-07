import { readFileSync } from 'node:fs';

export const observationType = 'task-cue-operation';
const fields = ['session_id', 'tool_call_id', 'parent_tool_call_id', 'phase', 'tool_name', 'attempted_target', 'reported_error'];
const nonempty = value => typeof value === 'string' && value.length > 0;
export const operationKey = record => JSON.stringify([record.session_id, record.tool_call_id, record.parent_tool_call_id]);

// Encode untrusted scalars before clipping. Never interpolate raw control/bidi characters.
export function scalar(value, limit = 100) {
  const encoded = JSON.stringify(String(value)).replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  const points = Array.from(encoded);
  return points.length <= limit ? encoded : points.slice(0, limit - 1).join('') + '…';
}

export function validObservation(value, sessionId) {
  return value && typeof value === 'object' && Object.keys(value).length === fields.length &&
    fields.every(field => Object.hasOwn(value, field)) && value.session_id === sessionId &&
    nonempty(value.tool_call_id) && nonempty(value.tool_name) &&
    (value.parent_tool_call_id === null || nonempty(value.parent_tool_call_id)) &&
    (value.phase === 'attempted' ? value.reported_error === null &&
      (value.attempted_target === null || ['write', 'edit'].includes(value.tool_name) && typeof value.attempted_target === 'string' && Array.from(value.attempted_target).length <= 240) :
      value.phase === 'reported-result' && typeof value.reported_error === 'boolean' && value.attempted_target === null);
}

// Read only. SessionManager's loader repairs trailing newlines and skips corruption.
export function canonicalEntries(file, sessionId) {
  const gaps = new Set();
  const entries = new Map();
  try {
    const raw = readFileSync(file, 'utf8');
    if (!raw.endsWith('\n')) gaps.add('partial canonical file');
    const lines = raw.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const header = JSON.parse(lines.shift());
    if (header.type !== 'session' || header.id !== sessionId || header.version !== 3) {
      gaps.add('unknown canonical session schema');
      return { entries, gaps };
    }
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!nonempty(entry.id) || !nonempty(entry.type)) { gaps.add('malformed canonical entry'); continue; }
        if (entries.has(entry.id)) {
          // Only identical observations from the exact same entry ID may deduplicate.
          if (JSON.stringify(entries.get(entry.id)) !== JSON.stringify(entry)) {
            gaps.add('conflicting canonical entry ID'); entries.set(entry.id, null);
          }
        } else entries.set(entry.id, entry);
      } catch { gaps.add('malformed canonical entry'); }
    }
  } catch { gaps.add('canonical save unavailable'); }
  return { entries, gaps };
}

export function project(branch, canonical, sessionId, recordingGaps = []) {
  const gaps = new Set([...canonical.gaps, ...recordingGaps]);
  const records = [], seen = new Map(), groups = new Map(), transcript = new Map();
  for (const entry of branch) {
    if (!entry || !nonempty(entry.id)) { gaps.add('missing branch entry identity'); continue; }
    if (seen.has(entry.id)) {
      if (JSON.stringify(seen.get(entry.id)) !== JSON.stringify(entry)) gaps.add('conflicting branch entry ID');
      continue;
    }
    seen.set(entry.id, entry);
    if (entry.type === 'message') {
      const message = entry.message;
      const calls = message?.role === 'assistant' && Array.isArray(message.content) ? message.content.filter(part => part.type === 'toolCall') : [];
      for (const call of calls) {
        if (!nonempty(call.id) || !nonempty(call.name)) { gaps.add('malformed transcript call'); continue; }
        const key = operationKey({ session_id: sessionId, tool_call_id: call.id, parent_tool_call_id: null });
        const prior = transcript.get(key) ?? { attempts: 0, results: 0, name: call.name };
        prior.attempts++; if (prior.name !== call.name) gaps.add('transcript tool-name mismatch'); transcript.set(key, prior);
      }
      if (message?.role === 'toolResult') {
        if (!nonempty(message.toolCallId) || !nonempty(message.toolName)) gaps.add('malformed transcript result');
        else {
          const key = operationKey({ session_id: sessionId, tool_call_id: message.toolCallId, parent_tool_call_id: null });
          const prior = transcript.get(key) ?? { attempts: 0, results: 0, name: message.toolName };
          prior.results++; if (prior.name !== message.toolName) gaps.add('transcript tool-name mismatch'); transcript.set(key, prior);
        }
        if (message.nestedCalls) gaps.add('nested transcript coverage differs from execution observations');
      }
    }
    if (entry.type !== 'custom' || entry.customType !== observationType) continue;
    if (!validObservation(entry.data, sessionId)) { gaps.add('unknown observation schema or session identity'); continue; }
    const saved = canonical.entries.get(entry.id);
    const source = saved && JSON.stringify(saved) === JSON.stringify(entry) ? 'saved' : 'live-only';
    if (source !== 'saved') gaps.add('observation save uncertain');
    const record = { entryId: entry.id, source, data: entry.data };
    records.push(record);
    const key = operationKey(entry.data);
    const group = groups.get(key) ?? { attempts: [], results: [], names: new Set() };
    group.names.add(entry.data.tool_name);
    (entry.data.phase === 'attempted' ? group.attempts : group.results).push(record);
    groups.set(key, group);
  }
  const unresolved = new Set();
  let paired = 0;
  for (const [key, group] of groups) {
    if (group.attempts.length !== 1 || group.results.length !== 1 || group.names.size !== 1) unresolved.add(key);
    else paired++;
    if (group.attempts.length > 1 || group.results.length > 1) gaps.add('repeated operation identity');
    if (group.names.size !== 1) gaps.add('observation tool-name mismatch');
  }
  // Transcript is a coverage cross-check, NOT a second attempt/result observation.
  for (const [key, value] of transcript) {
    const group = groups.get(key);
    if (!group || group.attempts.length !== value.attempts || group.results.length !== value.results || !group.names.has(value.name)) {
      gaps.add('top-level transcript observation coverage gap'); unresolved.add(key);
    }
  }
  // No instrumentation can assert complete historical or invisible child coverage.
  if (records.length === 0) gaps.add('no operation observations');
  const lastResult = records.filter(record => record.data.phase === 'reported-result').at(-1);
  return { records, paired, unresolved: unresolved.size, gaps: [...gaps], lastResult,
    outcome: unresolved.size || gaps.size ? 'unknown' : 'recorded-results-only' };
}

export function cueText(projection) {
  const last = projection.lastResult;
  const progress = last ? `${scalar(last.data.tool_name, 45)} / ${scalar(last.data.tool_call_id, 60)} / reported ${last.data.reported_error ? 'error' : 'success'} / ${last.source}` : 'no task-cue result observations recorded';
  return [
    'Advisory only; preserve latest user request and all tools.',
    'Goal: Refer to agreed goal and non-goals in the conversation; do not widen scope silently.',
    'Non-goals: No semantic drift/completion judgment. No automatic replay or blanket human gate.',
    'Source: Fixed advisory guidance, not a newly detected human instruction.',
    `Progress: ${progress}`,
    `Unknowns: ${projection.outcome}; explicit unresolved observation identities=${projection.unresolved}; coverage gaps=${projection.gaps.length}; paired=${projection.paired}`,
    'Coverage: Current branch only. Starts are attempted dispatch, not process starts. Results are reports, not fresh artifact inspection or process exit proof. Child internals and uninstrumented history are not recovered. Missing instrumentation does not mean work is unfinished.',
    'Continue by inspecting available evidence and current state as needed.',
  ].join('\n');
}

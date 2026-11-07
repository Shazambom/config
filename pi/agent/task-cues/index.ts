import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { realpathSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { observationType, scalar, validObservation, canonicalEntries, project, cueText } from './observations.mjs';

type Receipt = { sessionFile: string; generation: string };

export default function taskCues(pi: ExtensionAPI) {
  let expected: Receipt | undefined;
  let sessionId: string | undefined;
  let stopped = false;
  const recordingGaps = new Set<string>();

  function canonical(file: string) {
    try { return realpathSync(file); }
    catch { return join(realpathSync(dirname(file)), basename(file)); }
  }

  function admitted(ctx: any): Receipt | undefined {
    try {
      if (stopped) return;
      const file = ctx.sessionManager.getSessionFile();
      const id = ctx.sessionManager.getSessionId();
      if (!file || !id || sessionId && sessionId !== id) return;
      const identities: any[] = [], admissions: any[] = [];
      pi.events.emit('subagents:identity', { respond: (snapshot: unknown) => identities.push(snapshot) });
      pi.events.emit('session-lifecycle:admission', { respond: (snapshot: unknown) => admissions.push(snapshot) });
      if (identities.length !== 1 || admissions.length !== 1) return;
      const identity = identities[0], owner = admissions[0];
      if (identity?.status !== 'root' || identity.sessionFile !== file || owner?.managed !== true ||
          owner.status !== 'owned' || typeof owner.generation !== 'string' || !owner.generation ||
          owner.sessionFile !== canonical(file)) return;
      if (expected && (expected.sessionFile !== owner.sessionFile || expected.generation !== owner.generation)) return;
      sessionId = id;
      expected ??= { sessionFile: owner.sessionFile, generation: owner.generation };
      return expected;
    } catch { return; }
  }

  pi.on('session_start', () => { expected = undefined; sessionId = undefined; stopped = false; recordingGaps.clear(); });
  pi.on('session_shutdown', () => { stopped = true; });

  function observe(event: any, ctx: any) {
    try {
      if (!admitted(ctx)) return;
      const attempted = event.type === 'tool_execution_start';
      const data = {
        session_id: ctx.sessionManager.getSessionId(),
        tool_call_id: event.toolCallId,
        parent_tool_call_id: event.parentToolCallId ?? null,
        phase: attempted ? 'attempted' : 'reported-result',
        tool_name: event.toolName,
        attempted_target: attempted && ['write', 'edit'].includes(event.toolName) && typeof event.args?.path === 'string' ? scalar(event.args.path, 240) : null,
        reported_error: attempted ? null : event.isError,
      };
      if (!validObservation(data, sessionId)) { recordingGaps.add('malformed live observation'); return; }
      // Synchronous ownership recheck immediately before append. No additional journal.
      if (admitted(ctx)) pi.appendEntry(observationType, data);
    } catch { recordingGaps.add('observation save uncertain'); }
  }
  pi.on('tool_execution_start', observe);
  pi.on('tool_execution_end', observe);
  pi.on('context', (event, ctx) => {
    try {
      const owner = admitted(ctx);
      if (!owner) return { messages: event.messages };
      const branch = ctx.sessionManager.getBranch();
      const saved = canonicalEntries(owner.sessionFile, sessionId);
      const facts = project(branch, saved, sessionId, recordingGaps);
      const content = cueText(facts);
      if (Array.from(content).length > 1200 || !admitted(ctx)) return { messages: event.messages };
      // Never filter or mutate originals, even an identically named foreign custom message.
      return { messages: [...event.messages, { role: 'custom' as const, customType: 'task-cue', content, display: false, timestamp: Date.now() }] };
    } catch { return { messages: event.messages }; }
  });
}

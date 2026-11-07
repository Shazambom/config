import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function recoveryFixture(work, reply, task) {
  let issued = false, checked = false;
  const resumeTask = `${task}_RESUME_WITHOUT_REPLAY`;
  return {
    setRoot() {}, resumeTask,
    decide(input) {
      if (!issued) {
        issued = true;
        return { tool: 'fixture_recovery_hold', args: {} };
      }
      writeFileSync(join(work, 'recovery-resumed-provider-input.json'), JSON.stringify(input, null, 2));
      const texts = input.messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.text).join('\n'));
      assert(texts.some(t => t.includes(resumeTask)), 'new resume task reaches actual provider');
      assert(texts.some(t => t.includes(task)), 'original task remains visible');
      const cue = texts.find(t => t.startsWith('Advisory only; preserve latest user request and all tools.'));
      assert(cue?.includes('Unknowns: unknown'), 'real resumed cue preserves uncertainty');
      assert(cue.includes('explicit unresolved observation identities=1'), 'one interrupted operation stays unresolved');
      assert.equal(readFileSync(join(work, 'workspace/recovery-counter.txt'), 'utf8'), '1\n', 'effect not replayed');
      checked = true;
      return { text: reply };
    },
    verify() { assert(checked); return { resumedUnknown: true, unresolved: 1, effectCount: 1 }; }
  };
}

import assert from 'node:assert/strict';
import { leafFixture } from './leaf.mjs';

// Not yet executed: requires the real identity producer plus real lifecycle admission.
export function rootCuesFixture(work, reply) {
  const leaf = leafFixture(work, reply);
  const prefix = 'Advisory only; preserve latest user request and all tools.';
  let rootInputs = 0, childInputs = 0;
  const contents = message => typeof message.content === 'string'
    ? [message.content]
    : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text);
  return {
    setRoot: leaf.setRoot,
    decide(input) {
      const child = JSON.stringify(input.messages).includes('BOUND_LEAF_PROFILE');
      const cues = input.messages.filter(message => message.role === 'user')
        .flatMap(contents).filter(content => content.startsWith(prefix));
      if (child) {
        childInputs++;
        assert.equal(cues.length, 0, 'actual native child receives no root-only cue');
      } else {
        rootInputs++;
        assert.equal(cues.length, 1, 'actual root provider input contains one cue');
        assert(Array.from(cues[0]).length <= 1200, 'cue context remains bounded');
      }
      return leaf.decide(input);
    },
    verify(alive) {
      const result = leaf.verify(alive);
      assert(rootInputs > 0 && childInputs > 0, 'both actual native identities exercised');
      return { ...result, rootInputs, childInputs, rootCueOnly: true };
    }
  };
}

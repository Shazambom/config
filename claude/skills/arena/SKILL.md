---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Fan out N parallel attempts at the same task. Read every candidate end to end. Pick the strongest as the base. Graft the best ideas from the others into it. Verify the synthesized result.

## Start

Track one checklist entry per phase before launching anything. Use an available task tracker or a short written checklist; do not invent a tool.

1. Frame
2. Fan out
3. Cross-judge
4. Pick
5. Graft
6. Verify

## Phase A: Frame

The N candidates will receive the same prompt, so the prompt is the contract. Get it right before spawning anything.

1. State the artifact each candidate is producing.
2. Derive the rubric. State what success looks like for *this* task, then turn it into 3-6 concrete gradeable criteria. Concrete: `Adds a --dry-run flag that skips writes`. Vague: `code is correct`. The rubric is the picker's tool in Phase D; candidates only see the task.
3. Pick capable runners from the runtime's authenticated provider/model choices. Prefer different model families when available and useful. Do not copy model IDs from another tool's roster or route a model through an unauthenticated provider. If only one family is available, use separate fresh attempts on it and state that limitation. Do not claim model diversity you did not have. Honor an explicit user choice; report unavailable requested models rather than silently replacing them.
4. Assign output paths. Each candidate writes to its own location (`/tmp/arena-<slug>/candidate-<n>/`). Candidates must not write to the same path.

## Phase B: Fan out

Spawn N fresh subagents using the available delegation tool. Pi launches them asynchronously; do not add unsupported background flags. Give each the same task and grounding, its own output path, and instructions to produce the artifact and a short rationale.

Candidates work independently until they submit. Do not disclose other candidates' conclusions, direct them to sibling output paths, or ask them to reach consensus. The coordinator may clarify scope or correct a misunderstanding without revealing another candidate's answer. Existing conversation or files are not a security sandbox; do not claim information isolation beyond these controls.

The rationale is mandatory. Without it, the parent cannot tell whether a candidate's structure is principled or accidental, which makes Phase E grafting unreliable. Each rationale names the alternatives the candidate considered and what it rejected.

If a candidate fails to produce output, proceed with N-1 and note the dropout in the synthesis record.

## Phase C: Cross-judge

After all Phase B candidates complete, choose a capable authenticated model for one read-only judge. Prefer a different family from the coordinator when available; otherwise disclose the same-family comparison. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves. Spawning while candidates are still writing means the judge sees partial or empty outputs and reports them as dropouts.

## Phase D: Pick a base

Read every candidate end to end before picking. Skimming N candidates surfaces only the candidate whose surface looks most familiar.

Score each candidate against the rubric criterion by criterion, not on holistic feel. Compare against the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base on which candidate a future maintainer can extend most easily without breaking invariants. Prefer the simpler boundary when scores are tied.

Record the pick and the reason in a short synthesis note alongside the base artifact, including the cross-judge's verdict.

## Phase E: Graft

Walk each losing candidate once more and identify what is worth porting into the base. The signal is usually one or two things per candidate, not most of it.

Adapt each graft to the chosen design. Don't paste mechanically. The result has to remain coherent under one mental model.

Record what was grafted, from which candidate, and what was rejected and why. The rejection notes are the highest-signal part of the record. Future readers learn from what you considered and dropped, not just what you kept.

When independently submitted candidates converge on the same shape, record the agreement without treating it as proof of correctness. No graft is needed. When N candidates wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Run the synthesized artifact through its actual use path and compare the result against the rubric. Read every delegated output directly. Keep a repeatable verification script or evidence artifact when practical, and state what remains unverified. Compilation or a candidate's self-report is not proof.

If verification surfaces a problem the arena did not catch, either Phase A was wrong (re-frame and re-run) or one candidate caught it and you missed the graft (go back to Phase E). Don't paper over.

## Outputs

One synthesized artifact. One short synthesis note alongside, naming the base, the grafts (with source candidate), the rejections, the dropouts if any, and the verification result.

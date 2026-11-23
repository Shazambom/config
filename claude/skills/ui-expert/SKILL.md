---
name: ui-expert
description: Audit, score, verify, and improve a UI/UX end to end. Uses a research subagent to refresh industry UI/UX standards, a blank-slate user-roleplay auditor to weight and score the interface, independent verifiers with a hard issue cap, a plain-language $unslop + /bro sign-off gate, a $simplify pass on the plan, execution, /code-review medium, and a post-run improvement loop.
---

# UI Expert

End-to-end UI and UX audit, verification, and redesign workflow. Judge interfaces from the user's mental model first, verify every claim independently, get plain-language sign-off before editing code, simplify the plan, implement, and code-review the output.

## Before you run

Check these traps before starting (updated from `references/lessons.md`):

- **Never read implementation source before the blank-slate pass.** Reading component names, comments, or formulas first destroys cold-start user judgment and hides jargon.
- **Capture all themes and states.** Always inspect both dark and light themes (if supported) plus empty/setup, loaded, filtered, expanded/detail, and error states.
- **Keep auditor and verifiers isolated.** A verifier must never reuse the auditor's session or see peer verdicts; same-context self-review does not satisfy independent verification.
- **Verify current platform and API limits.** Check live constraints (rate limits, search-bar character caps, available fields) before proposing fixes that the platform cannot support.
- **Never edit product code before user sign-off.** Stop at Phase 4 until the user approves the direction, unless the user explicitly skipped sign-off.

## Arguments

`[target UI: route/component/URL/screenshots] [--audit-only] [--cap N] [--persona "role"]`

- `target`: The screen, flow, component, live preview, or screenshot set to evaluate. Ask if ambiguous.
- `--audit-only`: Stop after Phase 4 (verified report + plain-language proposal) without planning or editing code.
- `--cap N`: Override the maximum verified issues in the final report (default `8`, matching `$code-review medium`; ceiling `15`, never a quota).
- `--persona`: Pin the target user role for the blank-slate walkthrough (otherwise infer from the product domain).

## Read and run

Resolve reference paths relative to this `SKILL.md`. Read [rubric](references/rubric.md), [sources](references/sources.md), [verification](references/verification.md), and [lessons](references/lessons.md) before running.

### Phase 0: Capture target surfaces

Gather concrete visual evidence of the target UI before launching the audit:
- Live app or preview screenshots across primary states: setup/empty, populated default, filtered/sorted, expanded/detail, action outcome (e.g. clicking a row action or modal), and error/edge state.
- Both dark and light themes when the app supports theming.
- Neighboring screens (2 to 3) so the auditor understands the product's visual language and navigation without reading code.

### Phase 1: Research subagent (context + industry refresh)

Spawn a fresh subagent to gather skill context and bring the knowledge base up to date:
1. Read this `SKILL.md` and `references/{rubric,sources,lessons}.md`.
2. Run live web searches for current industry UI/UX best practices relevant to the target interface type (for example: triage dashboards, data tables, forms, onboarding, WCAG 2.2 / APCA contrast, progressive disclosure) and for real user workflows/complaints in the target product's domain (forums, wikis, community tools).
3. Compare fresh industry findings against `references/rubric.md` and `references/sources.md`.
4. Return:
   - Domain workflow notes for the auditor (how real users actually perform this job in the wild).
   - Any outdated, superseded, or missing guidance in `references/rubric.md` or `references/sources.md`.
5. If verified industry standards changed or a durable principle is missing, update `references/rubric.md` or `references/sources.md` (and bump `Last refreshed`) before moving to Phase 2, or record that the skill is already current.

### Phase 2: Blank-slate user roleplay and weighted audit (subagent)

Spawn a fresh auditor subagent with a **blank-slate context**:
- Give it ONLY the captured screenshots / rendered UI, the user persona, the domain workflow notes from Phase 1, and `references/rubric.md`.
- Explicitly forbid reading repository source code during this pass so internal terminology cannot bias first impressions.
- Instruct it to:
  1. **Roleplay cold** screen by screen as the target user trying to finish real tasks. Record every moment of confusion, jargon collision, squinting, hidden affordance, broken context, or hesitation ("what am I supposed to do now?").
  2. **Judge against Good UI / Good UX vs Bad UI / Bad UX traits** in `references/rubric.md`.
  3. **Weight every rubric factor by importance and relevancy** to this specific UI (weights must sum to 100%, adjusted from the archetype table in `references/rubric.md` with brief justification).
  4. **Score each factor from 0 to 10** and compute the weighted composite score.
  5. **Emit a candidate issue list** using the candidate schema in `references/verification.md`, citing exact visual locations, affected factors, and concrete user impact.

### Phase 3: Independent verification and capped, priority-ordered report

Mirror `$code-review`'s independent verification discipline (details in `references/verification.md`):

1. **Deduplicate** candidates that share the same root UX/UI defect mechanism, keeping the clearest user scenario and strongest visual evidence. Distinct mechanisms on the same component stay separate.
2. **Verify independently:** Spawn one fresh verifier subagent per deduplicated candidate (isolated context, never reusing the auditor or sharing other verdicts; use bounded waves if concurrency is limited).
   - Each verifier receives ONLY its assigned candidate, the captured screenshots/rendered UI, and read access to the relevant source files, styles, theme tokens, and API/platform constraints.
   - Each verifier checks whether the claim is real, accurate, non-speculative, and feasible, returning `CONFIRMED`, `PLAUSIBLE`, or `REFUTED` with direct visual and code evidence.
3. **Filter:** Drop every `REFUTED` claim. Only independently verified (`CONFIRMED` and `PLAUSIBLE`) issues may enter the final report.
4. **Order by importance and criticality:** Sort verified issues strictly from highest user/business impact and highest factor weight down to lower-impact polish (see criticality hierarchy in `references/verification.md`).
5. **Apply the cap after verification:** Keep at most the top `N` verified issues (default `8`, matching `$code-review medium`). All caps are ceilings, never quotas; an empty report is valid.
6. **Final report check:** Send the assembled report draft and verifier outputs to one fresh read-only checker to confirm score math, evidence accuracy, ordering, cap compliance, and zero unverified claims. If independent subagent delegation is unavailable, state that limitation explicitly and never label same-context review as independent.

### Phase 4: Plain-language proposal (`$unslop` + `/bro`) and user sign-off gate

Before writing a detailed plan or modifying any code:

1. Summarize the verified findings and proposed redesign direction at a high level.
2. Pipe the entire user-facing explanation through both:
   - **`$unslop`**: cut AI tells, em dashes, puffery, abstract metaphors, passive voice, and filler; name concrete behaviors and numbers.
   - **`/bro`**: restate in plain human language with zero jargon, short coherent sentences, like one human talking to another.
3. Present:
   - The weighted UI/UX score summary (overall score + top weak factors).
   - The capped, criticality-ordered verified issues (concise, plain speech).
   - The high-level proposed changes and any real product choices (thresholds, defaults, workflow tradeoffs).
4. **Stop and wait for explicit user sign-off** on the direction and changes. If `--audit-only` was passed, stop here.

### Phase 5: Build the plan and run `$simplify` against it

Once the user signs off:

1. Write a concrete implementation plan addressing every approved verified issue (exact files, state/data flow, copy changes, layout/theme contrast fixes, rate-limit/API constraints, and tests).
2. Run **`$simplify`** against the plan across all four lenses before writing code:
   - **Reuse:** Replace proposed new helpers or UI widgets with existing shared components and utilities in the repo.
   - **Simplification:** Cut redundant state, unnecessary config knobs, premature abstractions, and copy-paste branches.
   - **Efficiency:** Eliminate extra API calls, wasted renders, or heavy client work.
   - **Altitude:** Fix root causes at the right layer instead of layering special-case bandaids on broken structure.
3. Tighten the plan with the `$simplify` cuts.

### Phase 6: Execute the simplified plan

1. Implement the simplified plan cleanly in the codebase.
2. Add or update unit, integration, and style/accessibility checks covering the changed behavior.
3. Run the repo's test and lint gates.
4. Capture updated rendered screenshots (same states + dark and light themes) to visually confirm every verified issue is fixed and no layout or contrast regressions appeared.

### Phase 7: Run `/code-review medium` on the code output

1. Run `/code-review medium` against the resulting diff/working tree.
2. Fix confirmed defects and concrete cleanup issues raised by the review.
3. Re-run affected tests and verify the final rendered screenshots if UI code changed during review fixes.

### Phase 8: Post-run audit and skill improvement loop

Every run ends with a short self-audit, following the playbook improvement rule:

1. Look back over the session and ask:
   - Did Phase 1 research uncover outdated or missing UX standards or domain patterns?
   - Did verifiers refute auditor claims because a rubric rule or cold-read instruction was vague?
   - Did visual verification or `/code-review medium` catch a UI/UX defect (contrast, focus, state lag, rate limit) that Phase 2 missed?
   - Did the user flag jargon, confusing framing, or wrong priorities at the Phase 4 sign-off gate?
   - Did any capture step, subagent handoff, or script fail, retry, or need a workaround?
2. For each "yes":
   - Prepend one **condensed, general, dated lesson** (1 to 2 lines, phrased as a rule for next time, not a story of this run) to `references/lessons.md`.
   - If the lesson is a pre-flight check, add a one-line bullet to **Before you run** in this `SKILL.md`.
   - If Phase 1 found updated industry guidance, ensure `references/rubric.md` and `references/sources.md` reflect it.
3. If the skill files in `~/config/claude/skills/ui-expert/` were updated, redeploy locally (`bash ~/config/claude/setup.sh` and `bash ~/config/init.sh --antigravity`) and note the updates clearly in the final handoff.
4. If the audit found nothing to add, say explicitly in the final summary that the post-run audit found no new lessons.

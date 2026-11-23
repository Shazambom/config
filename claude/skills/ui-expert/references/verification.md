# Independent verification, ranking, and issue cap

Modeled on `$code-review`'s verification discipline so UI audits produce high-signal, proven findings instead of bloated wishlists or ungrounded opinions.

## Candidate schema (from Phase 2 auditor)

Every candidate issue returned by the blank-slate auditor must include:

- `id`: short slug (`ui-01`, `ui-02`, ...).
- `surface`: screen, state, theme, and exact visual location (for example: `Stash > Merchant | loaded table | Bleed column & filter tab`, or `Divinity light theme | expanded ItemCard header`).
- `factor`: one of the 8 rubric factors in `references/rubric.md` plus its assigned weight.
- `severity`: `critical`, `high`, `medium`, or `low`.
- `summary`: one-sentence claim naming the concrete UI/UX defect.
- `short_summary`: at most 60 characters, just the claim.
- `user_scenario`: what the target user tried to do, what confused or blocked them, and the real impact.
- `evidence`: exact visible text, badge, layout behavior, or screenshot reference observed.
- `suggested_direction`: concise outcome-focused fix direction (not speculative code).

No minimum candidate count applies. Do not pad counts to fill a quota.

## Deduplication rules

Before launching verifiers, pool and deduplicate candidates by **root UX/UI defect mechanism**:
- Merge candidates that describe the same underlying confusion or broken pattern across two screenshots (keep the clearest scenario and all screenshots as evidence).
- Keep distinct mechanisms on the same row or component separate (for example: unlabeled currency icons and missing expand chevrons on the same table row are two separate defects).

## Independent verifier contract (Phase 3)

Launch **one fresh verifier subagent per deduplicated candidate** (bounded parallel waves if concurrency is limited; never drop candidates to fit a wave).

Isolation rules:
- Never reuse the Phase 2 auditor session as a verifier.
- Never share peer candidates or other verdicts with a verifier.
- Give each verifier ONLY its assigned candidate, the captured screenshots/rendered UI, and read access to the codebase (components, CSS/theme tokens, domain logic, backend/API constraints).

Each verifier must inspect BOTH the rendered visual evidence AND the underlying implementation/constraints before issuing one verdict:

- **`CONFIRMED`**: The defect is directly observable on the rendered UI and backed by code, styles, contrast values, or usability standards, with a concrete user failure or readability violation. Quote the exact UI text/element and relevant file/lines (or computed contrast/behavior).
- **`PLAUSIBLE`**: The UX mechanism is real and supported by the UI/code, but its severity or frequency depends on runtime data, viewport size, or user preference. Quote supporting evidence and state the exact uncertainty clearly.
- **`REFUTED`**: Disproven by the actual rendered UI, an existing clear affordance/guard, or a hard external/API constraint that makes the claim inaccurate as framed. Pure subjective aesthetic preference with zero observable usability, clarity, or accessibility cost is also `REFUTED`.

Retain `CONFIRMED` and `PLAUSIBLE`; drop all `REFUTED` claims.

## Criticality ordering

Rank retained verified issues strictly by importance and criticality before applying the cap:

1. **Tier 1 (Task blockers and misleading data):** Broken workflows, dead-end states, destructive context loss, sidebar/state pollution, or metrics/labels that actively mislead the user into wrong decisions.
2. **Tier 2 (Mental model and decision failures on high-weight factors):** Opaque jargon, backwards priority signals, missing core triage verdicts, or unreadable critical values (such as unlabeled currency icons).
3. **Tier 3 (Major workflow friction and missing controls):** Missing sort/search/batch tools, unexplained truncation caps, or hidden primary affordances.
4. **Tier 4 (Accessibility and theme contrast failures):** Failing WCAG 2.2 AA / APCA contrast on dark or light themes, color-only status/rarity indicators, keyboard or target-size failures.
5. **Tier 5 (Layout hierarchy and secondary polish):** Dead space in drawers, minor alignment or toast clarity improvements.

Within the same tier, rank `CONFIRMED` ahead of `PLAUSIBLE`, and higher rubric factor weight ahead of lower weight.

## Hard output cap

Apply the cap **only after** independent verification and criticality sorting:

- **Default max issues: `8`** (matches `$code-review medium`).
- Override with `--cap N` (hard upper bound `15`, matching `$code-review xhigh/max`).
- Every cap is a **ceiling, never a quota**. If only 3 issues verify, report 3. An empty report (`0` issues) is valid when the UI is already strong.

## Final report check

After all candidate verifiers return, send the weighted score breakdown, deduplicated verified list, and raw verifier outputs to one fresh read-only checker. It verifies:
- Every reported issue has an independent `CONFIRMED` or `PLAUSIBLE` verdict (zero `REFUTED` or unverified claims leaked in).
- Weighted score math sums to 100% weight and computes accurately.
- Ordering follows the criticality tiers and obeys the issue cap.
- Coverage limits (untested states, missing themes, API constraints, or unavailable subagent isolation) are stated honestly.

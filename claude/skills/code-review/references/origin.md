# Origin and portability

This skill adapts a supplied local extraction of internal Claude Code review prompt construction. The extraction was `cr-region.txt`, 418 lines, from the supplied scratchpad snapshot. It begins inside surrounding bundled source and ends at `RWE=`, before the inline-comment prompt text and model-routing table. It is evidence for the visible workflow, not a complete implementation or public API contract.

The visible canonical default defines medium as eight independent finder angles with up to six candidates each, deduplication, one three-state verifier per candidate, and a cap of eight. High keeps those angles and budgets with recall-biased verification and a cap of ten. Xhigh/max add language pitfalls and wrapper delegation, use up to eight candidates per angle, and add a gap sweep with a cap of fifteen final findings. Low is a hunk-only pass without children or verification, capped at four and excluding tests/fixtures.

The excerpt also contains model-specific variants, inline/no-verifier variants, finding floors, remembered effort, cloud fallback, reporting branches, and partial action hooks. Their presence does not establish which model gets which workflow because the routing table is outside the excerpt. Native model and tool symbols are not portable configuration. This skill deliberately uses the canonical default workflow and available tools, not name-based routing or inferred native internals.

Portable decisions are explicit: medium resets each invocation; counts are ceilings; cloud/unknown options are rejected; non-ignored untracked changes are included in local scope; every new sweep candidate is verified; delegation inherits an authenticated available model; and chat JSON substitutes for an absent report tool. Inline-comment safety is specified here rather than attributed to the missing `RWE` body. Fix reporting uses one final report rather than assuming the native follow-up reporting mechanism exists.

Two source claims need limits. A touched function is not permission to hunt unrelated legacy bugs. A closure does not inherently retain its entire enclosing scope or leak memory; actual captured values and lifetimes must support retention findings. Altitude recommendations also need a concrete cost and should preserve simple local solutions when appropriate.

Do not execute the minified extraction, depend on its temporary path at runtime, or bundle unrelated extracted source with this skill. These Markdown files contain the portable instructions needed to run the review.

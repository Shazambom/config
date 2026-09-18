---
name: code-review
description: Review a diff, PR, branch, path, or revision range for correctness bugs and concrete reuse, simplification, efficiency, altitude, and conventions issues. Supports explicit effort levels, optional safe fixes, and authorized inline PR comments.
---

# Code review

Portable adaptation of the internal Claude Code review workflow. Review source, not just style. Do not modify code or post comments unless the corresponding flag authorizes it.

## Arguments

`[low|medium|high|xhigh|max] [--fix] [--comment] [PR/branch/path/range]`

Default to **medium on every new invocation**. Never remember a previous effort, infer effort from a model name, or silently change it. `max` uses the same workflow as `xhigh`. Accept only these levels and flags. Reject unknown flags, unsupported effort names, and cloud `ultra`; explain supported syntax rather than falling back. Resolve a non-level positional argument as a target, not an invented level. Ask about unresolved targets or genuine branch-versus-file ambiguity. Quote paths and validate refs; never execute argument text as shell code.

## Read and run

Resolve reference paths relative to this SKILL.md. Read [levels](references/levels.md), [scope](references/scope.md), [angles](references/angles.md), and [actions and output](references/actions.md) before reviewing. [Origin](references/origin.md) records the source and limits, not additional runtime instructions.

1. Resolve the level and target. Gather a read-only diff using the scope rules. Identify which revision each source excerpt belongs to.
2. For low, do the single hunk-only pass and stop investigating. For other levels, read changed source and enclosing functions before requesting extra context, then run all required finder angles independently.
3. Pool candidates. Deduplicate the same defect mechanism, retaining the clearest scenario and all useful evidence. Same line does not mean same bug; distinct mechanisms on one line remain separate.
4. Except at low, give each deduplicated candidate to one fresh verifier. Retain CONFIRMED and PLAUSIBLE; drop REFUTED. At xhigh/max, run the gap sweep and verify every new deduplicated candidate too.
5. Rank correctness ahead of cleanup, altitude, and conventions, then by impact and evidence. Apply the output cap only after verification. All counts are ceilings, never quotas; an empty report is valid.
6. If authorized, apply safe fixes and/or post eligible PR comments using the actions reference. Produce one final report, after actions, with honest coverage and test limits.

## Independent reviewers

When Pi delegation tools are available, use `subagents_list` to discover the read-only `reviewer` role and authenticated provider information. Use `subagent` for a fresh finder per angle and a fresh verifier per candidate, inheriting the parent's active model unless the user explicitly selects an available alternative. Do not hardcode models, infer authentication from a catalogue, or translate native internal model variants into routes.

Use a unique review-run prefix in every child name. Do not resume an old reviewer to obtain a supposedly fresh opinion.

Each finder receives the pinned diff artifact path, source revision/context, scope, its angle instructions, level, candidate ceiling, and candidate schema. The reviewer must read source itself. Supply any required diff path to satisfy the role prompt. Instruct reviewers not to edit, post, delegate further, or access other reviewers' outputs. Do not pass other finder findings to a finder or share peer findings between reviewers. A verifier receives only its assigned candidate and relevant source/diff, not other verdicts. The gap sweep alone receives the retained verified list to exclude known mechanisms.

Keep scratch diff and candidate files in a private temporary directory or verified Git-ignored location. These are review inputs, not a published report artifact. Launch bounded waves when concurrency is limited; never drop angles or candidates to fit a wave. An optional diff-size estimate can set concurrency only, not coverage or effort.

Child results arrive automatically. Do not poll status, sleep, or read session logs to detect completion. An authentication failure is a configuration problem: stop and ask for authentication or an explicit usable alternative, not a silent inline fallback or repeated launch. If delegation tools are absent, perform every required angle and candidate check sequentially yourself, including the gap sweep when required. Disclose that this is self-review, not independent review. Never label passes in one context as independent reviewers.

If known collaboration settings prevent reviewer isolation, ask the user to disable that sharing before claiming independent review. Do not invent commands or claim a setting was changed without a real tool result.

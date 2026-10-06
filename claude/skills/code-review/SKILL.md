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
6. If authorized, apply safe fixes using the actions reference. Assemble the final draft, including action outcomes and coverage/test limits, then complete the final report verification below before presenting findings or posting PR comments. Append actual posting receipts to the verified report.

## Final report verification

At every level, including low and empty reports, wait for all required finder reports, candidate verdicts, and any gap sweep and its verdicts. Then send the aggregate draft and those reports to one new read-only agent with fresh context. It must not have participated as a finder, candidate verifier, gap-sweep reviewer, or fixer, and must not resume an earlier session.

Give it the pinned diff, source revisions, level/scope, and evidence for coverage, tests, and actions. Require it to read the underlying diff and relevant source/evidence independently, not endorse the other agents' conclusions. Check the aggregate claims, severity, locations, duplicate mechanisms, contradictions, uncertainty, and coverage/test/action claims. Keep this a bounded verification pass, not another angle hunt. At low, use only the supplied hunks and action/check evidence, with no extra source investigation.

Have it return supported claims, corrections, refutations, and unresolved limits with evidence. Drop refuted findings, correct the draft, and label unsupported claims unverified rather than inventing evidence or tests. Preserve the level's output cap and candidate-verdict semantics. If corrections introduce substantive claims, have the final verifier check those before release. Do not publish findings early in chat, report tools, or `--comment` posts. If source or findings change after this check, reverify the affected draft before release.

If a fresh independent agent cannot run, report the blocked gate and ask the user how to proceed. Sequential self-review cannot satisfy this gate; do not present it as an independent pass.

## Independent reviewers

When Pi delegation tools are available, use `subagents_list` to discover the read-only `reviewer` role and authenticated provider information. Use `subagent` for a fresh finder per angle and a fresh verifier per candidate, inheriting the parent's active model unless the user explicitly selects an available alternative. Do not hardcode models, infer authentication from a catalogue, or translate native internal model variants into routes.

Use a unique review-run prefix in every child name. Do not resume an old reviewer to obtain a supposedly fresh opinion.

Each finder receives the pinned diff artifact path, source revision/context, scope, its angle instructions, level, candidate ceiling, and candidate schema. The reviewer must read source itself. Supply any required diff path to satisfy the role prompt. Instruct reviewers not to edit, post, delegate further, or access other reviewers' outputs. Do not pass other finder findings to a finder or share peer findings between reviewers. A verifier receives only its assigned candidate and relevant source/diff, not other verdicts. The gap sweep receives the retained verified list to exclude known mechanisms. The final report verifier receives the aggregate and reports as specified above.

Keep scratch diff and candidate files in a private temporary directory or verified Git-ignored location. These are review inputs, not a published report artifact. Launch bounded waves when concurrency is limited; never drop angles or candidates to fit a wave. An optional diff-size estimate can set concurrency only, not coverage or effort.

Child results arrive automatically. Do not poll status, sleep, or read session logs to detect completion. An authentication failure is a configuration problem: stop and ask for authentication or an explicit usable alternative, not a silent inline fallback or repeated launch. If delegation tools are absent, the finder angles and candidate checks may run sequentially as self-review, including the gap sweep when required. Disclose that limitation and stop at the blocked final report gate. Never label passes in one context as independent reviewers.

If known collaboration settings prevent reviewer isolation, ask the user to disable that sharing before claiming independent review. Do not invent commands or claim a setting was changed without a real tool result.

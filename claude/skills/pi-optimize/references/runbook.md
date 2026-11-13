# Campaign runbook template

Copy this template into the invocation's unique, verified Git-ignored campaign directory before any benchmark run. Fill facts from evidence, leave unknowns explicit, and preserve unrelated existing material. On resume update the same record and ledger; do not reset budget. This checklist is a hypothesis backlog, not a scheduled sweep.

## Historical index, read before hypothesis or preparation

Authoritative history index: <one existing project-level path in the verified Git-ignored workspace; reuse across sessions, not a new competing log>

- [ ] Read history on start/resume before selecting hypotheses or preparing trials; reconcile uncertain counts with full ledgers/evidence.
- [ ] Check prior tested families and their scope before proposing work. New session alone is never a retest reason.
- [ ] Before launch record changed conditions, a new hypothesis, or authorized confirmation justifying any retest. Keep task-specific negatives scoped.

Compact entry, one per hypothesis/family/session:
- Scope / invariants / profile versions: <comparison boundary>
- Factor / trial IDs / evidence links: <authoritative ledgers and raw artifacts>
- Outcome / confidence / status: <keep, reject, inactive, saturated, invalid>
- Budget spent / unused: <charged attempts; reconcile with full ledger>
- Pending work / next action: <resume here, not replay>
- Retest condition: <explicit change, new hypothesis, or authorized confirmation; record before launch>
- Visible correction: <prior conclusion and reason; invalid remains charged/excluded>

Update at result checkpoints/handoff without blocking a ready authorized trial. This index does not replace evidence. Keep it compressed, with no transcripts or secrets.

## Top-of-session invariant register

Complete at session start/resume and verify before every attempt. Missing/ambiguous values require asking the human before launch; no invented defaults. Only an explicit USER instruction changes a pin. A broad settings-optimization request does not authorize such changes.

| Invariant | Value | Human source | Effective override / precedence | Proof |
| --- | --- | --- | --- | --- |
| Main model / provider / auth route | <fixed> | <instruction> | <actual invocation/settings> | <evidence> |
| Reasoning effort | <human-dictated, comparator-matched> | <instruction> | <actual invocation/settings> | <evidence> |
| Human-fixed sampling / token limits | <fixed or clarify> | <instruction> | <actual invocation/settings> | <evidence> |
| Task / official grader per comparison | <fixed> | <authorization> | <resolved revisions> | <evidence> |
| Resource / time budgets and concurrency cap | <fixed> | <authorization> | <actual controls> | <evidence> |
| Required verification / permissions | <fixed> | <instruction> | <effective scope> | <evidence> |
| Baseline / fresh-state conditions | <fixed> | <agreement> | <actual state> | <evidence> |
| Total / option / harness trial budgets | <fixed, spent, remaining> | <authorization> | <ledger/reservation> | <evidence> |

Experiment-variable allowlist: <each eligible knob, authorization evidence, prerequisites; exclude human pins>. Never automatically tune reasoning effort.

- [ ] Before EVERY launch, reconcile effective CLI/settings precedence against this register and confirm every diff is allowlisted, including concurrent attempts.
- [ ] After exit, verify recorded actual values. Any violation stops launches: retain grade/evidence, charge the attempt, mark protocol-invalid, exclude from winner comparison, and ask the human about resumption. No refund, silent exploratory relabel, promotion, or automatic rerun.

## Authority and current state

- Human invocation and date: <exact request, max-trials>
- Campaign identity and private directory: <path, git check-ignore evidence>
- Invocation history / resume decision: <prior runbook and remaining-budget reconciliation>
- Root driver / T3 or agreed executor: <owners and bounded responsibilities>
- Status: planning / index / preflight / running / assessing / paused / complete
- Authorized ceiling: <N>; launched: <n>; remaining: <N-n>
- Uncertain launches requiring reconciliation: <IDs and evidence, never silently omitted>
- Preexisting baselines excluded only by explicit agreement: <authorization>
- Reference harness rerun allowance: <none unless explicitly authorized>
- Mode and harness allocation: <optimization or human-authorized paired screening; total ceiling and separate allowances, e.g. total 20 = Pi 10 + Codex 10, not 20 each>
- Prior closed campaign: <spent/unused budget, closure instruction and frozen profile; do not reset or reopen>
- Concurrency: <default 1; explicit human authorization/cap required for parallelism, e.g. up to 2 across different tasks with the same frozen profile>
- Current batch: <attempt IDs, shared profile hash, per-attempt reservations, aggregate resource/cost limits and monitoring; no extra allowance>
- No work is complete merely because a helper reports success.

## Governing checks, reuse without adding per-trial ceremony

- [ ] Verify critical execution facts and intended action before launch; bounded-check uncertainties and ask the human if unverifiable. Experimental outcome uncertainty belongs in the hypothesis, not guessed facts.
- [ ] Apply KISS and the agreed MVP; no speculative knobs/dependencies/features or scope expansion. TDD only for authorized script/fix work; preserve official benchmark tests.
- [ ] Use bounded multi-angle research when churning, verify existing solutions, protect private data, and preserve the goal. Do not make research/document updates a gate for every trial.

## Baseline and frozen boundary

- [ ] Root inspected baseline artifacts and official grades; retain originals and hashes.
- [ ] Record task, benchmark/grader revisions, official scoring and correctness criteria.
- [ ] Freeze main model, provider/auth route, dependencies, image, limits, instructions, and versions.
- [ ] Record actual customized Pi source/config loading evidence; reject stock fallback.
- [ ] Freeze human-dictated reasoning effort and verify comparator matching; no effort variants without an explicit USER instruction.
- [ ] Record time/token definitions, uncertainty, missing diagnostics, and explicit tradeoffs; no invented weighted score.
- [ ] Keep reference solutions and task-specific answer hints out of task inputs.

Baseline artifact links: <files, actual values, totals versus means, sample counts>
Incumbent: <configuration hash, evidence, provisional/confirmed status>
Holdout plan and single-task overfitting limits: <no unapproved extra task runs>

## Settings coverage and hypothesis backlog

- [ ] Index documented built-ins and relevant extensions, including OM and auxiliary models.
- [ ] State coverage gaps; a documented-settings index is not an exhaustive hidden-extension audit.
- [ ] Check task applicability and actual tool calls before interpreting a setting trial; declarations alone do not establish use.
- [ ] Record `toolsAdded`/`toolsRemoved` as declarations; prose may omit native tools without `promptSnippet`. A raw MCP pass does not prove actual Pi use.
- [ ] Verify precedence and effective activation with source/runtime evidence before selecting trials.
- [ ] Screen presentation-only/inactive knobs early; conditional knobs require observed prerequisites.
- [ ] Record CLI overrides separately from file defaults; check observer/compaction and cache-warm triggers.
- [ ] Record interactions suggested by evidence without precommitting a configuration grid.

| ID / knob | Source / default | Configured / effective / override | Activation prerequisites / evidence | Class | State | Exclusion reason / hypothesis / linked trials |
| --- | --- | --- | --- | --- | --- | --- |
| <ID> | <citation> | <actual values> | <observed or unknown> | direct / conditional / inactive | untested | <reason and evidence> |

Allowed states: untested, source-screened-inactive, planned, running, inconclusive, rejected, confirmed. Link hypothesis -> trial IDs -> evidence -> root decision. Do not mark confirmed from one lucky observation.

## Preflight, isolation, and policy

- [ ] Check startup readiness, ownership guards, auth routing, installed CLI, and effective config without invoking the task solver.
- [ ] Diagnose missing/failing ownership observations; do not disable guards to make the run pass.
- [ ] Freeze/checksum inputs, instructions, skill/prompt revisions, dependencies, base image, limits, and configuration; never store secrets.
- [ ] Inspect actual readiness files and validate hashes before launcher invocation; do not infer readiness from a README/helper report.
- [ ] Verify image prerequisites once, retain logs, preserve original package HOLD selections as well as versions, reuse exact qualified bundles, and announce readiness without waiting for document bundling. Avoid endless mock-harness probes.
- [ ] Isolate experiments from parent/T3 sessions and deployed global settings.
- [ ] Keep Unslop for orchestrators; record any isolated solver metadata amendment, not identity spoofing/global disable.
- [ ] Confirm runner scripts only execute/measure and do not change Pi/task/grader behavior.
- [ ] Reserve next ID and remaining allowance; infrastructure-only checks have their own evidence record.

## Benchmark × configuration matrix

Bound rows to approved tasks and columns to eligible config-first profiles from actual friction, keyed by profile/invariant versions. Reuse valid completed cells; mark invalid cells explicitly, never as controls. This is a selection map, not an exhaustive Cartesian product, queued sweep, or budget reset.

| Approved benchmark row | Config/profile column + invariant version | Cell status / trial evidence | Candidate / source/image qualification | RAM / CPU fit + aggregate limits | Eligible next batch / exclusion reason |
| --- | --- | --- | --- | --- | --- |
| <task> | <frozen hashes> | pending / valid completed / protocol-invalid / blocked | <ready proof or gap> | <actual resource bounds> | <bounded selection> |

- [ ] Prepare ready eligible cells before launch; default same candidate profile across different tasks, private isolation, within explicitly authorized cap and aggregate resources/cost.
- [ ] Unqualified source/image cells are not launchable. If only one cell is ready/fits, record why and run singly rather than claiming useful parallelism.
- [ ] Reuse valid evidence instead of filling cells with 1:1 repeats; inspect all current batch exits/results before selecting another batch, no refill or active-profile changes.

## ONE trial record per attempt, next cycle only after root decides

### Trial <ID>, hypothesis <ID>, status <planned/running/exited/assessed>

- Budget before / launched charge / cumulative / remaining: <values>
- Problem and measured impact: <trace evidence; hot paths/model round trips/context/startup/cache>
- Why optimization is necessary: <user goal and tradeoff>
- Hypothesis and mechanism: <predeclared, distinguish observation from cause>
- Predicted observable effect: <metric and expected direction/size if defensible>
- Falsifier: <what observation would undermine this mechanism>
- Minimal config/prompt fix and diff: <one initial factor or justified interaction>
- Activation/prerequisite checks: <effective override and evidence>
- Per-launch invariant preflight / allowlist / post-run actual-value check: <register version, effective CLI/settings proof, mismatch or verified match>
- Protocol validity: <valid or protocol-invalid; retain official grade and charge even on violation, exclude invalid attempts from winner comparisons>
- Frozen input/config/image/dependency/instruction hashes: <links>
- Executor assignment and launch/exit/process evidence: <one bounded run>
- Official grade and raw result: <artifact links, actual values>
- Setup failure versus task failure: <classification; both count if solver launched>
- Per-call input incl. cache / cached subset / uncached / output / calls: <values, accounting>
- Startup / agent / grader wall time and tools/durations: <boundaries and values>
- First prompt, repeated paths, model round trips, cache misses: <trace links>
- OM auxiliary usage: <observed values or unknown, never assumed zero>
- Cost estimate: <method, not an invoice>
- Provider/cache/time-of-day noise and incumbent comparison: <evidence>
- Solver friction debrief / chronology / disclosure timing: <source attribution>
- Timeline authorization / independent verifier if published: <evidence or not requested>
- Actual outcome versus prediction, falsifier, baseline, incumbent: <analysis>
- Root conclusion: keep / reject / inconclusive; <rationale, correctness checks preserved>
- Learning and updated coverage/hypothesis links: <reasoning for resumption>
- Brief self-reflection: <What could I have done better? Assumption, missed evidence/instruction, earlier check, confidence or premature-stop error; next-cycle efficiency>
- Explicit record correction and reusable lesson, if supported: <earlier conclusion, correction, cause or unknown, next-time action and verification; no forced lesson>
- Skill/prompt revision changes: <frozen hashes, agent-facing diff, effect on comparison conditions; never inject into an active run>
- Tight-loop decision after actual exit/identity/official grade/metrics checks: (1) Did setup measurably improve correctness/time/tokens against baseline/incumbent? (2) Conclusive about setting; if not, why would confirmation be necessary rather than the next config change? (3) Exact next configuration?
- Config-first next action: <eligible knob addressing actual trace friction; screen config before prompt changes; any repeat/control requires explicit necessity within human guidance, or direct human instruction>
- Human correction captured: <substantive genuine process nudge, explicit ledger/history correction, refined lesson/rule/test as appropriate; off critical path, not automation/advisory authority>
- EXACT next decision, rationale, owner, bounded assignment: <compact learning entry, then immediately launch the next authorized cycle; default sequential, authorized batch only after all its predecessors exit>
- Completion-to-next-launch gap / decision-prep time / avoidable overhead / next action: <measure and reduce controllable overhead, preserve safety/correctness>

- [ ] Root owned the actual foreground watch/run command; a send/wait acknowledgement is not completion.
- [ ] Actual exit, official reward, per-step metrics, and bounded readable raw evidence inspected by root.
- [ ] Use actual Harbor `agent/trajectory.json` `.steps[].metrics` / `.final_metrics` and `result.json`; `metrics.json` only if present, or document another runner's schema.
- [ ] Count the launched attempt even if failed/inconclusive/cancelled; no silent retries.
- [ ] Distinguish bigger contexts from more calls; avoid cache subset double-counting and unknown-to-zero conversion.
- [ ] Correctness and required verification retained; no faster-but-wrong winner.
- [ ] With authorized parallelism, inspect both results before choosing the next configuration/batch; do not refill a slot early. Record concurrency timing confound and aggregate usage against unchanged sub-budgets.
- [ ] Record compact learning and next decision, then proceed immediately to the next authorized cycle; inconclusive evidence alone does not prioritize a repeat over the requested config-first change. Reuse verified image/install/prerequisites, checking invariants, changed inputs, and reservation rather than repeating full probes.
- [ ] Do detailed analysis/lesson writing/timeline verification while the next trial runs, not before launch; verify causal claims before publication. No complete postmortem or extra analysis agent per ordinary trial.
- [ ] Correct affected reports/ledgers explicitly before refining lessons; private specifics stay in the ledger, and committed guidance merges/revises supported rules.

## Batch completion brief

After all current batch exits/identity/official grades/metrics/traces are assessed, send a brief update, not a process essay. For sequential work, report the completed decision cycle. Partial status requests get known partial facts, never a completion claim.

- Ranked retained changes, top 2–4 by supported benefit/retention: <real keys/scopes; pass counts, time, input/cache-aware tokens, model calls versus valid baseline; verdict>
- Dropped, concise: <no-effect/harmful choices and scoped reason; archives are not recommendations>
- Status, remaining budget, no global promotion, and concise confound: <actual charged counts and uncertainty, no invented weighted score or causality>
On-deck, include remaining configs awaiting testing/ranking in every brief:

| Candidate | Exact delta | Target batch / tasks | Readiness / blocker | Selected or conditional |
| --- | --- | --- | --- | --- |
| <pending candidate> | <actual config keys/scope or conditional prompt after config screening> | <proposed, not queued> | <verified readiness or gap; unbuilt is not ready> | <root-admitted selection or conditional idea> |

Report promptly with available evidence; do not wait for bookkeeping, skill updates, exhaustive analysis, or nonessential receipts. No fabricated ready candidates, blind queue, budget reset, or bypass of pins/all-batch result checks.
- Config list / matrix link: <private authoritative evidence, not pasted full history>
- Drop / discard decision: <remove no meaningful benefit/effect across tested applicable rows from active lists/future cells; immediately discard clear harm without promotion or unchanged retrial; mixed/noisy evidence stays separately inconclusive>
- Long-running tool/setting qualification: <intended task horizon and sustained-work outcome; actual activation, calls/context/recovery evidence; user-accepted overhead; relevant baseline regression or provisional retention with benefit unproven. Do not reject for short-task cost or absent speedup when the intended benefit was not exercised. Avoid elaborate activation machinery to save minimal overhead.>
- Archived evidence and changed-condition reopening: <scoped finding, spent budget and explicit new hypothesis/changed condition; no silent retention or budget reset. Archives are not ranked recommendations>

## Candidate feasibility, cost, horizon, and saturation

Use only for human-authorized new-task screening; this backlog does not authorize launches or full-suite runs.

| Candidate / official task unit | Official grader / prerequisites | Meaningful gap / saturation risk | Horizon: elapsed, steps, context/recovery | Expected wall time / tokens / infrastructure | Per-trial ceilings / enforcement versus estimate | Selection / exclusion evidence |
| --- | --- | --- | --- | --- | --- | --- |
| <candidate> | <source and runnable unit> | <discrimination hypothesis> | <separate demands> | <estimate and uncertainty> | <approved limits and actual control> | <decision> |

- [ ] Agree total and per-trial wall-time/token/infrastructure ceilings and limit behavior before launches; do not invent approved defaults.
- [ ] Screen reasonable single-task units with official graders, not ten entire suites blindly.
- [ ] Keep locked Pi profile/comparator conditions and main model fixed; any needed scope change requires human authorization.
- [ ] Label official failure, abort, censored outcome, infrastructure failure, and unknown separately; all launched solver attempts count.
- [ ] One authorized pair per candidate is preliminary gap evidence, not statistical proof or general parity; keep separate Pi/comparator/total counts.
- [ ] Rank correctness gap, observed reliability/context recovery, time, tokens, auxiliary/infrastructure costs separately; no invented weighted score.
- [ ] Distinguish long elapsed time from long context. Do not generalize an OM-off short-task result into a global recommendation.

## Confirmation, research, and stop gates

- [ ] Prioritize eligible config-first changes from actual friction; use prompt changes only after relevant config options are screened unsuitable. Strong-candidate confirmation needs explicit necessity within human guidance, or human direction; justify count and track drift.
- [ ] Avoid best-run cherry-picking, unsupported significance/causality, and unsupported generalization.
- [ ] On stagnation/new edge cases inspect artifacts, then bound research by exact symptom, underlying mechanism, and existing approaches.
- [ ] Verify research references and protect private data; research does not silently change scope.
- [ ] Continue useful learning beyond one trial, without guaranteeing gains or wasting the allowance.
- [ ] Pause at ceiling, safety/auth failure, irreproducible scoring, or needed scope/model/code change.
- [ ] Check saturation/diminishing returns before another microtuning run or code escalation. Unused budget is not an obligation.
- [ ] If good enough/nondiscriminating, close the campaign, freeze the best verified profile with capability tradeoffs, and retain cheap tasks for regression, not continued optimization.
- [ ] Open new benchmark screening only with new human scope/budget authorization; never reset the old allowance.
- [ ] Only if meaningful gaps remain after config/prompt options are exhausted, propose code changes for explicit human approval before runtime/extension edits.
- [ ] Any promotion uses repository sources + existing `init.sh`, confirmed evidence, and rollback; never hand-edit deployment.
- [ ] Final report links ledger, improvements/regressions, correctness, uncertainty, budget, and remaining work.

## New-baseline handoff

Closed campaign / actual spent and unused allowance: <immutable ledger links>
Best verified profile / hashes / correctness / capability tradeoffs / rollback: <evidence>
Human authorization for new targets and separate budget: <request>
Screening gap rankings / costs / censored outcomes / uncertainty: <one-pair limitations>
Next target and proposed confirmation: <decision, not extra launch permission>
New baseline record linked to the old campaign: <frozen inputs and evidence>

## Method references and domain limits

- NIST, [Why use DOE?](https://www.itl.nist.gov/div898/handbook/pri/section2/pri212.htm). One-factor-at-a-time exploration can miss interactions; initial isolation does not imply independence.
- Kapoor et al., [AI Agents That Matter](https://agents.cs.princeton.edu/). Evaluate accuracy and cost together; preserve holdouts and reproducibility rather than declaring victory from a favorable example.
- Bergstra and Bengio, [Random Search for Hyper-Parameter Optimization](https://jmlr.org/papers/v13/bergstra12a.html). Adjacent ML evidence that only some parameters strongly affect outcomes. It does not establish which Pi knobs activate or authorize random batch sweeps.
- Anthropic, [Infrastructure noise](https://www.anthropic.com/research/infrastructure-noise). Vendor research on infrastructure confounding; record runtime conditions rather than attributing every timing change to a prompt.
- No source establishes an optimal trial allocation or timer threshold. The human's budget constrains this experiment.

The performance-analysis method is baseline -> profile where time/tokens go -> establish necessity -> propose problem/impact/fix/expected measured gain/falsifier. Go-specific examples such as N+1 queries, indexes, allocations, lock contention, goroutine leaks, buffering, and hot-path logging are domain examples, not presumed Pi defects or permission to do code work during the config-first phase.

# Pi harness work handoff

Snapshot: November 6, 2026. Repository: `/Users/ian/config`.

This is a work checklist, not approval to implement pending behavior or change models. The user wants all four original problems addressed. Only the checked-delivery slice and the narrow T3 delegation fixes have been implemented and deployed.

## Start here

- [ ] Read `CLAUDE.md`, `pi/agent/AGENTS.md`, and the relevant feature lessons before changing code.
- [ ] Inspect `git status` and the current diff. The worktree contains substantial existing changes. Do not reset, stage, commit or overwrite them as part of setup.
- [ ] Recheck the selected installed CLI with `pi/command-path.sh`. Do not assume the repository's fallback SDK is the active runtime.
- [ ] Confirm the pending scope and behavior decisions below with the user. Do not treat this handoff as consent.
- [ ] Assign each writer an exclusive file set. Keep tests and implementation tied to one acceptance case at a time.
- [ ] Report a blocker or failed deployment immediately. A successful setup exit alone is not feature readiness.

Use the simplest existing mechanism that meets the agreed requirement. No new framework, dependency, database, background model or configuration switch without a demonstrated need and approval. Research public sources when progress stalls; never search private code or session content.

## Work status

| ID | Work | Status |
|---|---|---|
| D1 | Explicit checked Pi deployment | Complete, reviewed, tested and deployed |
| T1 | Native T3 routing guidance, shared cwd and shipped profiles | Complete, reviewed, tested and verified in a fresh live T3 thread |
| S1 | Scope control | Design complete; implementation approval pending |
| E1 | Evidence and observer validation | Design complete; implementation approval pending |
| R1 | Recovery cards and interrupted-command reconciliation | Design complete; implementation approval pending |
| W1 | Recurring reminders during continuous work | Behavior reproduced; policy decision and implementation pending |
| M1 | Sol 6.1 memory comparison or switch | Not performed; approval and evaluation criteria pending |

The historical interrupted Bash command still has no known terminal outcome. R1 must preserve that uncertainty rather than invent an exit status.

## Completed work to preserve

### D1. Checked deployment

Command:

```bash
./init.sh --pi-delivery /existing/directory/new-receipt.json
```

It records setup exit separately from the exact selected package's RPC asset verification. A failed or unknown required check makes the explicit operation fail even if setup exited zero. It refuses existing receipt destinations. Entry-point and behavior fields remain `not_run`. Ordinary startup keeps its existing warning policy and creates no delivery archive.

Production files: `init.sh`, `pi/setup.sh`, `pi/delivery.sh`, `pi/rpc-readiness.sh`.

Existing proof:

- [x] `bash pi/test-delivery.sh`, independently rerun by the parent.
- [x] Actual copied installed CLI and Bash-tool path return `isError` and `exit_code` with the matching failed receipt.
- [x] Interactive PTY preserves credential-prompt stdin using synthetic credentials.
- [x] Identity-parser execution failures remain unknown; observed mismatches remain failed.
- [x] Existing destination, stale receipt, concurrency, cancellation and publication-failure controls.
- [x] Worker rejected the disabled-check mutant. Do not describe that mutation run as parent-executed.
- [x] Actual checked deployment passed.

Parent test evidence: `$TMPDIR/pi-delivery.ggbwuu/`.
Deployment: `$TMPDIR/pi-delivery-installed.XmEAse/receipt.json`.
Lesson: `docs/lessons/pi-delivery.md`.

Accepted limits: static RPC asset verification is not runtime feature proof. The pre-existing concurrent installer race on `source.ts.portable` remains. SIGKILL can leave private temporary files. Linux and GUI acknowledgment were not verified.

### T1. Native delegation

With `--t3`, the existing `subagent` interface selects native T3 delegation. The changes clarify that already-authorized delegation needs no extra chat consent to change host mechanisms. Real permission checks remain.

An explicit cwd is accepted only if it resolves to the same existing canonical directory as the session. Shipped `lineage-only` profiles are supported through authenticated native parent bindings without copying parent turns. Fork requests remain refused. No profile was rewritten to standalone.

- [x] Parent reran same, relative, symlink and different-directory cases plus provider-input routing guidance.
- [x] Parent reran shipped-profile launch/resume and retained-resume controls.
- [x] Fresh live T3 used the unchanged shipped reviewer with explicit shared cwd.
- [x] Child returned the exact marker; the parent consumed a successful terminal result with matching native IDs.
- [x] No T3 app files/settings or application code changed. The original application session was not restarted.

Evidence: `$TMPDIR/t3-cwd-final-parent.nu5uV1/`, `$TMPDIR/t3-lineage-parent.WTGyCk/`, `$TMPDIR/t3-live-fresh.nHpFWy/`.
Deployment: `$TMPDIR/t3-lineage-deploy.1Nonve/receipt.json`.
Current checkpoint: `pi/tests/t3-adapter/STATUS.md`.

Important: a retained process may have cached adapter code. Verify loaded behavior before assuming deployment refreshed it. T3 CLI `--wait` can return after the initial parent run, while child completion arrives in a later parent run. Initial launch acknowledgment is not completion proof.

## S1. Scope control

Design: `reports/Harness scope evidence and recovery proposal.md`.

### Approval required

- [ ] Approve an operator-confirmed task revision and explicit delegation allocation.
- [ ] Accept cooperative enforcement, not a sandbox or a semantic relevance detector.
- [ ] Agree how allocations cover existing arena/review workflows without asking permission for every tool call.
- [ ] Keep protected native T3 activation unavailable until its approval interaction is verified. Missing UI support must not auto-approve.

### Implementation checklist

- [ ] Add the proposed task-controls extension and load it through repository settings after lifecycle admission.
- [ ] Preserve outcome, acceptance IDs, non-goals and accepted limitations in existing custom session entries.
- [ ] Require fresh confirmation of the exact revision. Model prose, reviewer messages and quoted consent cannot activate it.
- [ ] Keep suggestions separate from required criteria.
- [ ] Reserve assignment grants synchronously before supported launch or completed-child follow-up.
- [ ] Bind grants to task revision and assignment identity, not profile names or self-declared purpose.
- [ ] Partition nested grants explicitly. Parent and child cannot spend copies of one allocation.
- [ ] Rehydrate after reload/compaction. Branch navigation cannot refund grants. Forks need new approval and a new task identity.
- [ ] Keep ordinary reads, edits, checks, cleanup and late-result consumption available.
- [ ] Do not add arbitrary 60/80-tool quotas, close all tools after a passing check, or abort accepted work to enforce a pause.

Likely files: proposed `pi/agent/task-controls/index.ts` and `state.ts`, `pi/agent/settings.json`, and the authoritative `pi/patches/interactive-subagents.patch`. Verify exact integration points before coding; do not edit deployed upstream files as the permanent fix.

### Acceptance criteria and tests to build

- [ ] **S1-A:** After approval of criterion A, reviewer suggestion B cannot become required without another operator decision.
- [ ] **S1-B:** An unapproved extra assignment creates neither a tmux pane nor a native T3 task.
- [ ] **S1-C:** Renamed profiles, direct native aliases and repeated "repair verification" cannot mint grants.
- [ ] **S1-D:** Ordinary repair, acceptance checks, cleanup and late completion still work after acceptance passes or delegation capacity is exhausted.
- [ ] **S1-E:** Simultaneous launches cannot double-spend a grant. Uncertain dispatch does not silently refund it.
- [ ] **S1-F:** Compaction, reload, branch rewind, fork and stale approval responses preserve the authority boundary.
- [ ] **S1-G:** Amendments do not refund spent grants, revoke accepted work retroactively or discard older-revision results.
- [ ] **S1-H:** Disabling the gate makes the protected end-to-end case fail.

Start RED through the installed CLI with a private session and scripted provider. Test actual supported launch boundaries, not only a counter function. Prove terminal and native routes separately. Root-agent overthinking and arbitrary Bash subprocesses remain outside the guarantee.

## E1. Evidence and observer validation

### Approval required

- [ ] Approve one observable protocol, its expected raw fields and who owns the expectation.
- [ ] Agree on the evidence classes and provisional status for a new feature without a known-good reference.
- [ ] Do not expand the first slice into a universal test-certification service.

### Implementation checklist

- [ ] Add the proposed `/task check` operation and Bash/jq runner, with a small Pi event collector only where the API requires it.
- [ ] Bind verdicts to the criterion revision, exact executable/resources, observer digest, fixture origin, fresh challenge and raw evidence.
- [ ] Keep development tests, model claims, saved projections and live observations distinct.
- [ ] Freeze approved verifier bytes for a run; changed bytes invalidate approval rather than redefine success.
- [ ] Specify the raw correlation predicate before debugging a candidate implementation.
- [ ] Preserve separate pass, behavioral failure, observer failure and inconclusive results.
- [ ] Keep raw logs in private artifacts rather than injecting them into every model turn.

### Acceptance criteria and tests to build

- [ ] **E1-A:** A fresh challenge travels through the selected installed Pi route and reaches the required actual model input/output.
- [ ] **E1-B:** Independently disabling the target behavior fails the criterion even if a fixture remains green.
- [ ] **E1-C:** Valid captured input plus a deliberately broken projection decoder yields observer failure, not automatic product blame.
- [ ] **E1-D:** Broken capture, uncertain observer health or an uncalibrated timeout yields inconclusive.
- [ ] **E1-E:** A constant-success grader, stale challenge, wrong executable or changed verifier cannot count as accepted evidence.
- [ ] **E1-F:** Another valid implementation passes without relying on private function names or incidental output structure.
- [ ] **E1-G:** Tests assert the intended verdict and diagnostic, not merely nonzero exit or file creation.

A scripted loopback provider proves a Pi protocol path, not a live service or T3 GUI. The independent raw assertion is still a fallible observer. Do not manufacture a reference implementation or an automatic correctness oracle.

## R1. Recovery cards and interrupted commands

This covers both child recovery and the newer complaint about a root Pi Bash call. A child-only notification change does not address the root-command case.

### Approval required

- [ ] Approve automatic factual recovery cards and reconciliation before supported resume with uncertain effects.
- [ ] Accept explicit unknown outcomes where no trustworthy terminal receipt exists.
- [ ] Decide whether command-terminal receipt capture is required in the first slice or whether unresolved-call visibility is sufficient initially.
- [ ] Inspect existing `watch_shell` supervision before proposing another command supervisor. Do not silently replace synchronous Bash with fire-and-forget execution.

### Implementation checklist

- [ ] Record bounded operation metadata in existing session entries once the saved task conversation is established.
- [ ] Distinguish attempted dispatch, controller reservation and observed result. A tool-start event occurs before validation and does not prove OS process creation.
- [ ] Preserve exact session, launch, task, run, tool-call and parent-call identities where available.
- [ ] Show a root-session recovery card on resume for unresolved recorded calls, including the historical Bash case's uncertainty.
- [ ] Prepend child recovery facts to the existing `subagent_result` presentation before enqueueing it, including watcher rejection paths.
- [ ] Provide local inspection without requiring another model summary.
- [ ] Require an explicit reconciliation disposition for uncertain effects before supported continuation. Never replay automatically.
- [ ] Omit arbitrary command text, outputs, environment and credentials. Label attempted paths separately from current inspected artifacts.
- [ ] Keep T3 result consumption intact. No background `task_status` or consuming parent-output reads as neutral probes.

### Acceptance criteria and tests to build

- [ ] **R1-A:** A child completes a harmless write, then its next active provider response fails through the normal failure path. Parent notification contains recorded facts without a summarizer call.
- [ ] **R1-B:** If transport retries succeed or the child stays alive, report local state rather than invent a completion notification.
- [ ] **R1-C:** Stop an owned lab process after a local effect but before result recording. Resume reports unknown and does not duplicate the effect.
- [ ] **R1-D:** Interrupt and resume a root Pi Bash call. A real terminal receipt, if present, stays associated with that call. Otherwise show unresolved outcome, never fabricated success, exit code or completed cancellation.
- [ ] **R1-E:** Stale receipts, missing/truncated entries, nested calls and unwritable recording storage produce explicit coverage gaps.
- [ ] **R1-F:** A recorded child exit does not clear uncertain inner operations or imply detached descendants stopped.
- [ ] **R1-G:** Record enqueueing separately from parent-model consumption and human visibility. Verify native T3 delivery through its actual host path.
- [ ] **R1-H:** Only owned test processes are interrupted; an unrelated sentinel survives cleanup.

Use a process barrier for outstanding-command tests. Do not assume an active provider socket exists while an awaited tool is running. Do not infer process liveness from old timestamps or saved history.

## W1. Busy recurring reminders

### Verified state

The live busy probe advanced its next deadline but produced no saved wake before cancellation. Source holds recurring reminders while busy, dispatches on `agent_end`, and clears pending local notices on cancellation. An idle control in the same T3 diagnostic thread produced a real wake entry, autonomous response and cancellation. Both diagnostic timers were cancelled.

This does not establish what happened to the historical timer. It does show that the tested idle T3 route works and that busy deferral can reproduce the reported pattern.

### Decision and checklist

- [ ] Ask whether recurring reminders should arrive at the next safe boundary during continuous work instead of waiting for the entire run to end.
- [ ] If approved, verify Pi's actual steering/follow-up ordering before choosing an implementation.
- [ ] Preserve the original task, current commands, ownership checks and coalescing.
- [ ] Decide the minimum lifecycle visibility needed. Do not call Pi message-flow acknowledgment model consumption.
- [ ] Keep reload/shutdown cancellation rules explicit; do not introduce durable timer restoration without approval.

### Acceptance criteria and tests to build

- [ ] **W1-A:** During a continuous busy run, a due recurring reminder reaches the intended safe boundary without needing the entire run to finish.
- [ ] **W1-B:** The active command completes normally; remaining task work and tool results are not silently lost.
- [ ] **W1-C:** Repeated ticks coalesce while delivery is pending. No duplicate registrations or blind resubmission.
- [ ] **W1-D:** Cancellation distinguishes pending local notices from notices already submitted. Test both races and retain truthful state.
- [ ] **W1-E:** Idle delivery still works, including an autonomous T3 continuation with no subsequent user prompt.
- [ ] **W1-F:** Ownership change, reload and shutdown prevent stale delivery.
- [ ] **W1-G:** Capture due observation, submission, persisted `custom_message` and model input separately. T3 UI absence alone cannot prove no inference.

Existing tests: `pi/test-wakeups-runtime.sh` and controller tests under `pi/tests/wakeups-runtime/`. Verify the current test layout before extending it. Preserve the existing original-task-loss and cancellation regressions. No wake behavior changes have been made yet.

## M1. Observational memory and token cost

At this inspection, both observer and consolidator use `openai-codex/gpt-5.6-sol` with medium thinking in `pi/agent/settings.json`. Re-read configuration before acting. No Sol 6.1 memory comparison or switch has been made.

- [ ] Ask whether to run a bounded comparison and agree on its sample, model calls and pass criteria.
- [ ] Compare observer and consolidator separately on the same frozen, private or synthetic input.
- [ ] First vary only the model, keeping thinking comparable. Test another thinking level only as a separate approved comparison.
- [ ] Measure uncached input, cached input, output, failures, latency and reported cost. Do not treat runtime cost estimates as invoices or subscription-quota measurements.
- [ ] Check retention of approvals, non-goals, unresolved operations, corrected facts and implemented-versus-proposed status.
- [ ] Reject an apparent saving that drops critical constraints or invents facts.
- [ ] If approved after evaluation, change repository configuration and deploy through `init.sh`. Do not edit the deployed settings directly.

The inspected November 6 snapshot contained 41 memory worker sessions, approximately 647k uncached input, 2.49M cached input and 108k output tokens, with $5.74 runtime-reported cost. This is a historical snapshot for this parent session, not an account-wide total or a verified bill.

The proposed S1/E1/R1 controls need no background watcher model. Context targets discussed were at most 400 tokens per task revision, 200 per verdict and 300 per recovery card. These are proposed budgets, not measurements. Add a test that the controls do not create extra summarization calls. Keep volatile status out of the system-prompt prefix so small updates do not unnecessarily defeat prompt caching.

## Release checklist for each approved slice

- [ ] State the exact outcome, non-goals and accepted losses before coding.
- [ ] Demonstrate a meaningful end-to-end RED with an independently specified assertion.
- [ ] Make the smallest fix and rerun that same assertion.
- [ ] Break the protected behavior deliberately and verify the test detects it.
- [ ] Run related regressions, not every suite after each small edit.
- [ ] Inspect the actual artifacts and exercise the actual installed input-to-output path.
- [ ] Get independent review for substantive changes; batch fixes rather than start repeated full reviews.
- [ ] Offer a production diff checkpoint and identify pre-existing changes and untracked files.
- [ ] Deploy only through `init.sh`, within approved scope. Do not restart unrelated sessions.
- [ ] Report success, failure and unchecked states promptly. Preserve private evidence outside commits.
- [ ] Update the relevant feature lesson and record what remains unverified.

The proposed S1/E1/R1 order is scope authority, one calibrated observer, then recovery. If the user prioritizes the new root-command complaint, agree on a smaller R1 slice first rather than making the entire controller a prerequisite.

## Evidence and references

Temporary artifacts may expire. Missing files mean missing evidence; do not invent prior test results. Runtime proof so far is macOS with Pi 1.0.4 and T3 0.1.7. Recheck versions before relying on those results.

| Evidence | Location |
|---|---|
| Remaining-controls arena, candidates, scores, judge, synthesis | `$TMPDIR/arena-harness-controls.Ct1bxp/` |
| Delivery design and completed-slice references | `reports/Harness delivery improvement proposal.md` |
| Remaining-controls design | `reports/Harness scope evidence and recovery proposal.md` |
| Public research and source links | `reports/Harness controls for reliable delivery.md` |
| Live shipped-profile delegation | `$TMPDIR/t3-live-fresh.nHpFWy/` |
| Busy recurring wake | `$TMPDIR/t3-live-wake-busy.DZxGXk/` |
| Idle recurring wake and autonomous response | `$TMPDIR/t3-live-wake-idle.87eqSo/` |
| Relevant lessons | `docs/lessons/pi-delivery.md`, `pi-t3-integration.md`, `pi-wakeups.md`, `pi-rpc-readiness.md`, `pi-session-lifecycle.md`, `pi-subagent-completion.md` |

### Complaint records and live-session contact

Both reports have immutable deferred investigation outcomes. Neither is fully addressed. Do not overwrite their outcome files or mistake deferral for completed implementation.

- Original four-item report: `$HOME/.pi/complaints/2026-11-06T06-48-09Z-gEiCxeov.complaint.json`.
- New T3 report: `$HOME/.pi/complaints/2026-11-06T16-34-06Z-6UbHkON9.complaint.json`.
- Outcome paths use the same basename with `.resolution.json`.

For a new `/address-complaint` invocation, follow the skill's `latest` selection and existing-outcome rules. Do not silently pick an older report. Preserve existing outcomes and report follow-up evidence separately; do not bypass the helper's no-overwrite rule.

The user authorized diagnostic contact with Pi session `01a1af90-0690-721d-89c8-6aa1adfa55cc`. It mapped to native T3 thread `78a0bd51-0829-49a9-aa1a-32f111ed86b5`. Recheck identity and current activity before further contact. Use the supported native CLI or authenticated protocol, never direct team-file writes or borrowed identity. Do not assume it is still idle.

The disposable diagnostic thread was `mcp:8470a652-7efb-4817-b636-83c48a7dfe28`. Its last observed run completed and both diagnostic timers were cancelled. T3 owns any retained processes. Do not kill them or user work to tidy a test.

No additional information is currently needed to locate the original session. New actions still need to respect its current activity and the user's approval boundaries.

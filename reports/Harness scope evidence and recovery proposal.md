# Harness scope, evidence and recovery proposal

**Proposal for approval; no implementation of these three controls has started.** The separate checked-delivery slice is being implemented independently.

The arena used two Astra and two Sol 6.1 candidates. Parent and cross-judge selected candidate 3 as the base, then strengthened delegation admission, observer classification and recovery delivery. We rejected mandatory 60/80-tool quotas, stopping all tools after a passing check, aborting already-admitted work, and a second authoritative journal.

## Design in one sentence

Add a small task-controls extension that preserves the approved requirements, admits only approved delegated assignments, runs one calibrated acceptance protocol, and attaches recorded progress to worker failure reports without asking another model to reconstruct it.

These are three separately testable slices sharing task IDs and existing session entries—not a new orchestrator. They do not guarantee semantic scope correctness, arbitrary test correctness, or exactly-once external effects.

## 1. Scope control: freeze requirements and gate new assignments

### Concrete behavior

A proposed `/task scope` command displays the intended outcome, numbered acceptance criteria, non-goals, accepted limitations and proposed delegation allocation. A fresh operator confirmation approves the exact revision. The agent may propose amendments but cannot approve them through a tool argument, reviewer message or quoted consent.

After approval:

- Model-facing operations cannot add or replace required acceptance criteria. Reviewer suggestions remain separately labelled suggestions.
- Supported child launches and completed-child follow-ups require an approved assignment grant. Reserve it synchronously before asynchronous launch; bind it to task revision and immutable launch/assignment identity.
- Grants apply regardless of profile name. Renaming a reviewer to `worker`, calling a native delegation alias, or labelling another pass “repair verification” cannot mint authority.
- Nested delegation uses explicitly partitioned grant IDs: the parent records their transfer before launch and cannot spend them afterward; the child may spend only its assigned subset. No copied spendable budget. Without an approved subset, that child cannot delegate further.
- Amendments grant future authority; they do not refund spent IDs, retroactively revoke accepted work, or discard results from an older revision. Those results retain their original revision label. Explicit cancellation remains a separate action. Reservation can be consumed even when a later permission handler refuses execution.
- Delegated follow-ups are explicitly part of an approved allocation or require an amendment. There is no automatic refund after an uncertain launch result and no unlimited follow-up disguised as one old assignment.
- Root reads, edits, tests, status inspection, cleanup, and normal consumption of late child results remain available. A passing test displays satisfied criteria; it does not shut down the tool system or deploy automatically.

The allocation is part of the task decision, not an unexplained global quota. No mandatory tool-count default is introduced. Existing arena/review workflows must show their proposed assignment allocation as a group, rather than demand a confirmation for each tool call. The UI and tests must demonstrate that ordinary agreed work remains usable.

### What this actually enforces

It prevents silent changes to authoritative requirements and additional supported delegation without authority. It does **not** determine whether every edit is relevant, stop root-agent overthinking, or inspect arbitrary programs launched through Bash. Live steering cannot be semantically classified as “still the same task” with certainty. Those limits must remain visible; do not call this complete prevention of scope creep or an agent security sandbox.

A safety concern can pause delivery for an operator decision; it does not silently authorize a larger project or get ignored just because it is outside the initial criteria.

### State and ownership

Proposed files: `pi/agent/task-controls/index.ts` and `state.ts`; an explicit loading entry after lifecycle admission in `pi/agent/settings.json`; grant integration in `pi/patches/interactive-subagents.patch` at the supported terminal/native launch and follow-up boundaries. These names are proposals, not existing APIs.

Use existing `pi.appendEntry` custom entries and an in-memory projection. Rehydrate on session changes; enforce from the recorded decisions, not compaction summaries. Consumption is monotonic across branches of the same task. Navigating to an older branch cannot restore old authority or refund grants. A conflicting branch requires explicit reconciliation. A fork does not inherit spendable grants: new approval establishes a new task identity, avoiding two session files spending copies of one allocation.

Session entries are not immediately durable before a conversation exists. Activate protected work only after the saved task conversation and approval are actually persisted; otherwise report pending/unavailable protection. Do not add another journal merely to cover command-only startup. This is process-recovery evidence, not an fsync/power-loss guarantee or protection from hostile same-user file edits.

Terminal confirmation is the first verified approval target. RPC trusts its controlling client, not an independently authenticated human. Actual T3 approval presentation/response must be proved before enabling guarded activation there. Unprotected ordinary Pi usage remains unchanged; missing approval support must not silently auto-approve.

### First RED/GREEN proof

Approve criterion A and a specified delegation allocation through the isolated installed CLI. Inject reviewer suggestion B, try to promote it to required, and request an extra assignment. Require unchanged criteria and no extra pane/native task, while an ordinary edit, A's check, cleanup and late child completion still work. Approving an exact amendment permits only that new authority.

Negative controls cover renamed profiles, direct native aliases, completed-child follow-ups, concurrent reservations, forged/stale approval, compaction, branch rewind and fork adoption. Disabling the admission check must make the test fail.

## 2. Observation control: calibrated evidence, not automatic blame

### Concrete behavior

A proposed `/task check <criterion>` invokes an approved observer through existing scoped tool execution. First support **one installed-Pi fresh-challenge protocol**, not every arbitrary project test.

The operator approves the expectation, observer identity and evidence class. Record the actual executable/resources, observer digest, fixture origin, fresh challenge ID, call IDs, timestamps and raw evidence references. Development tests and model statements remain visible but cannot silently become calibrated live evidence. Editing the approved observer invalidates its approval rather than redefining success mid-investigation.

The first protocol must be fixed before implementation: a private scripted provider drives a harmless tool through the selected bundled CLI; capture the designated live records before interpreting them, correlate their call IDs and fresh challenge, and separately assert the returned value reaches the next provider input/final output as required. Saved projections cannot substitute for the designated live event contract. Exact raw fields and predicates belong to the approved check—not a parser improvised after a failure.

### Verdict matrix

| Observation | Permitted verdict |
|---|---|
| Fixed raw contract and calibrated expectation satisfied | Pass for this criterion and scenario |
| Independently disabled behavior with a known-working observation path | Behavioral failure, not an inferred root cause |
| Known-valid captured input satisfies the fixed raw predicate, but an injected decoder defect rejects it | Observer failure for that decoder |
| Missing capture, unknown observer health, conflicting evidence or uncalibrated timeout | Inconclusive |

The raw assertion is also an observer. “Independent” means its fixed predicate does not reuse the defective projection decoder, not that it is infallible. A second model or parser does not manufacture truth.

Calibrate with a known-good reference, independently disabled behavior, a constant-success grader and a broken decoder. For a genuinely new feature, first calibrate transport/schema using an existing harmless operation and retain a meaningful RED for missing behavior. Mark feature semantics provisional until a valid reference outcome is witnessed; do not invent one or block all development waiting for it.

### Implementation and first proof

Proposed files: `pi/acceptance.sh`, a small API-specific event collector under `pi/agent/task-controls/`, and focused tests. Bash/jq own orchestration and assertions; TypeScript is limited to Pi's actual event API. Freeze the selected verifier bytes outside the candidate workspace for a run and verify their identity before/after. This is cooperative provenance, not OS isolation.

RED: the actual runtime behaves correctly but a saved-projection decoder is substituted for the live observer. It must not authorize a product-failure claim. GREEN requires the calibration and provenance checks before emitting the fixed verdict.

Controls independently break target delivery, decoder and capture; replay a stale challenge; substitute another executable; modify the verifier; and exercise a different valid implementation. Assert the verdict and diagnostic, not just an exit code or existence of a manifest. A fixture pass is not actual T3, live-provider or deployed-guard proof.

## 3. Recovery: attach facts before another model summary

### Concrete behavior

Record compact operation metadata for enrolled workers using existing session entries. On failure, prepend a deterministic recovery card to the existing result notification:

```text
Assignment: exact launch / task / run identity
Last observed result: tool call X, reported success/error
Known target: path explicitly supplied to write/edit
Unresolved: call Y has no recorded outcome
Worker exit/task state: independently observed, with timestamp
Coverage: identified session/launch interval; known recording gaps
Next action: inspect or reconcile; no automatic retry
```

No summarization model is needed to assemble these facts. A local proposed `/task recover <assignment>` renders the same evidence if the parent provider cannot accept another turn.

### Precise event semantics

Distinguish attempted dispatch, this controller's permit reservation, and observed result. Do not call a reservation final tool admission: later permission handlers can reject the call. Installed `tool_execution_start` occurs before validation/permission checks, so it does not prove an OS process started. A result record is observed tool output, not unmodified external-system truth.

Capture tool/parent-call IDs, task revision, immutable assignment identity and allowlisted metadata. Do not record full arguments, shell commands, environment, credentials, arbitrary output or raw provider errors in the card. A write target is an attempted path; reported write success is not current artifact validity. If inspected later, show current existence/hash with a separate timestamp. Arbitrary Bash-created paths remain unknown. Escape and bound displayed text; path redaction cannot guarantee removal of all sensitive information.

Missing/truncated records mean incomplete coverage. A missing result does not establish whether an effect occurred. No card authorizes replay.

### Actual integration points

Proposed `pi/agent/task-controls/recovery.ts` records compact metadata once a saved task conversation exists. `pi/patches/interactive-subagents.patch` augments terminal `watchSubagent` result presentation **before** its existing `pi.sendMessage({customType:'subagent_result', display:true}, {triggerTurn:true, deliverAs:'steer'})`. Cover both a returned nonzero result and watcher rejection. The parent verified this source route; enqueueing is not proof of model consumption or human acknowledgment.

For T3, attach metadata at the existing exact-assignment result-handling route, preserving its normal completion consumption. Never add background `task_status` calls or parent terminal-output reads as neutral probes. Native tasks may finish while their Pi processes remain alive. Prove native delivery separately; terminal success is not GUI parity.

Before supported resume with uncertain inner effects, require a reconciliation disposition tied to the exact assignment and unresolved IDs. Destination or owned-process checks may resolve it. Otherwise the operator must choose further investigation or explicitly accept a specific retry risk. The model cannot clear unknown outcomes merely by declaring them safe. No automatic retry, command replay, worker adoption or exactly-once guarantee.

### First RED/GREEN proof

Let a real child complete a harmless write, then fail its **next active provider response** before handoff prose. Deliberately reach the normal terminal failure path after applicable retries; require the resulting parent notification to contain the recorded outcome and reference without another summarizer call. If the child instead remains alive or retries successfully, assert local card availability—not a fabricated completion notification. Test enqueueing separately from parent-model consumption. Do not assume a provider socket exists while a tool is blocked.

Separately stop only the isolated lab child after a local counter effect but before its result is recorded. Require an unknown outcome and no duplicate effect on resume. Use a process barrier for outstanding-command tests. Cover stale launch receipts, partial records, live process versus failed transport, nested calls, compaction and unrelated sentinel survival. Run the actual private T3 backend before claiming native result-delivery support.

## Build and acceptance order

1. **Scope revision and assignment admission:** establish identity and the smallest authority boundary; leave ordinary tools and completion handling alone.
2. **One calibrated observation:** bind one criterion to fixed observable semantics and prove the verdict matrix.
3. **Recovery card and reconciliation:** reuse task identities/session metadata and existing completion routes.

Each gets its own failing end-to-end test, smallest implementation, unchanged GREEN assertion, focused regression and review checkpoint. Do not wait for a general platform to ship the first slice. Coordinate source ownership with the separate delivery worker; no overlapping edits.

Deployment remains through `init.sh`, using existing resource copying and pinned patches. Verify actual loaded resources in a new isolated runtime. Rollback removes only these resources/settings/patch hunks; retain historical records, unrelated changes and user sessions. No implementation or tests for these three controls ran during this arena.

## Research that shaped the design

- [OpenAI approval flow](https://openai.github.io/openai-agents-python/human_in_the_loop/): pending decisions bound to specific operations; serialized state is not authentication. Applied to revision/assignment decisions, not approval on every tool.
- [OpenAI bounded run loops](https://openai.github.io/openai-agents-python/running_agents/): useful inspiration for controlled exhaustion, but not justification for arbitrary Pi-wide 60/80-tool caps.
- [Anthropic evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) and [Harbor task/verifier/reference separation](https://github.com/harbor-framework/harbor/blob/main/AGENTS.md): calibrate the observer and separate expectation from implementation. No new framework or evaluator fleet.
- [Claude subagent behavior](https://docs.anthropic.com/en/docs/claude-code/sub-agents): partial results and resumable identities inspire explicit incomplete state; they do not establish Pi behavior.
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts): restarted nodes can repeat effects. This is why recovery reconciles rather than replays.

Sources were fetched by candidates and compared with installed Pi 1.0.4/source contracts. This is source-grounded design verification, not executed runtime proof.

## Approval requested

Approve these three bounded slices in this order, including cooperative enforcement, explicit delegation allocations, operator-owned grader semantics, incomplete-state reporting and no automatic uncertain-effect replay. Terminal/operator approval is the initial supported target; protected native activation and result delivery require their separate host proofs. Further capability gaps should be brought back as decisions, not silently added to the project.

# Scope control and bounded delivery

Research for the task dated 2026-11-06. Five primary pages fetched in one pass. SDK documentation below is rolling documentation, not a pinned release or locally tested capability. No Pi runtime inspection was performed; whether Pi already supplies equivalent controls is unknown. Recommendations are proposals, not claims that these products implement scope control automatically.

## How can an approved MVP resist expansion?

### Takeaway
Use a small, user-approved task contract and require approval to change it. Enforce objective boundaries in tool dispatch; do not pretend a path allowlist can decide whether an abstraction is necessary.

### Cited Findings
- Anthropic's long-running experiment used a feature list, one feature per session, progress artifacts and end-to-end verification. Restrictions on changing requirements were strongly worded prompts, not demonstrated immutable storage. Its initializer expanded one request into over 200 features. That expansion is unsuitable as a default for a tightly scoped MVP. This is a reported experiment, not a general guarantee. [Anthropic, Effective harnesses for long-running agents, publication dated November 26, 2025 in search metadata](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)
- OpenAI documents pre-execution checks for guarded function tools. Agent input guardrails only run for the first agent; output guardrails run at final output. Parallel input checks can allow tool side effects before cancellation. Function-tool guardrails do not cover built-in shell/apply-patch tools, hosted tools or handoffs. These are documented implemented capabilities and explicit coverage limits. [Agents SDK guardrails, rolling Python documentation](https://openai.github.io/openai-agents-python/guardrails/)
- Anthropic recommends simple solutions and adding complexity only when measured outcomes justify it. This is engineering guidance, not enforcement. The page identifies its original context as December 2024 and now warns that tooling has changed. [Building effective agents, mutable article](https://www.anthropic.com/engineering/building-effective-agents)

### Inferences
Proposed control 1: freeze the contract, not every implementation decision.

- Enforcement point: task admission and mutation dispatch. Store the approved outcome, acceptance commands or manual checks, non-goals, allowed working area and any explicitly prohibited changes outside agent-writable state. Assign a contract revision. Record the smallest demonstrable slice first.
- Minimum implementation: one host-owned record and a scope-change request. Reject modifications to that record through agent tools. At dispatch, block writes outside the approved area and restricted operations such as dependency changes when the contract prohibits them. Let ordinary in-scope implementation proceed without per-edit approval. New edge cases go into a deferred list unless they invalidate an approved requirement or expose a safety blocker.
- User approval boundary: the user approves changed outcomes, acceptance criteria, accepted losses or restricted operations. The agent can propose a revision but cannot approve it. Do not freeze an agent-generated inventory of speculative features as if the user requested them.
- Acceptance test: ask the agent to implement one behavior, then inject reviewer advice to add an unrelated fallback and change the acceptance test. The contract remains unchanged; prohibited writes do not execute; the requested behavior remains deliverable. Approving one revision permits only the revised scope.
- Failure risks: unnecessary abstractions inside allowed files remain possible. Tool arguments claiming an approved requirement are not proof of relevance. Shell, nested agents, remote tools and symlinks can bypass a naive path check. Route all mutation paths through the same policy, or explicitly label coverage partial. False positives should produce a concrete approval request, not lose the task.
- Classification: host-owned contract and dispatch restrictions are real controls. Deciding that a same-file change is unnecessary remains human judgment or fallible model review. Prompt-only scope advice is a useful baseline, not equivalent enforcement.

### Gaps
No fetched source establishes a reliable automatic test for semantic scope creep. Local Pi tool interception, shell isolation and approval coverage require separate verification before implementation.

## How can usable checkpoints arrive before review becomes endless?

### Takeaway
Make the first verified slice a required output, then bound review transitions. A review can find a blocker; it must not silently redefine the assignment.

### Cited Findings
- Anthropic reports that agents declared completion without adequate testing. Browser-driven end-to-end checks and incremental work improved its web-app experiment. The article does not provide a general effect size or prove applicability to every project. [Long-running agent experiment](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)
- Anthropic recommends evaluator-optimizer loops when evaluation criteria are clear and iteration provides measurable value. It also describes programmatic gates between workflow stages. This supports bounded evaluation, not an instruction to review indefinitely. [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- LangGraph documents durable interrupts that expose a payload and wait for external input. Resumption requires the same thread ID and restarts the interrupted node from its beginning. Side effects before the interrupt can therefore repeat. This is a documented runtime mechanism, not a scope policy. [LangGraph interrupts, rolling Python documentation](https://docs.langchain.com/oss/python/langgraph/interrupts)

### Inferences
Proposed control 2: require an evidence checkpoint before optional improvement.

- Enforcement point: transition from implementation to further feature work or cleanup.
- Minimum implementation: maintain one active acceptance slice. Before admitting another slice, require a checkpoint containing the artifact or diff revision, the runtime check result and known failures. The host records actual command exit status and evidence location rather than accepting a model-authored `passed` flag. Publish the checkpoint automatically; do not require another prose report before the user can inspect it.
- User approval boundary: the first checkpoint is inspectable, not automatically deployed or merged. Optional polish or a new requirement needs approval. Necessary fixes to the current slice remain allowed. A blocking defect must be visible, not concealed to meet a deadline.
- Acceptance test: the requested happy path passes while a reviewer suggests optional caching. The checkpoint appears before caching work; caching remains deferred. A failing runtime check produces an explicitly incomplete checkpoint rather than a success claim.
- Failure risks: tests can be weak, altered or disconnected from the running artifact. Bind results to the tested revision and approved test definition. A receipt proves execution, not test adequacy. Avoid a new checkpoint framework; reuse existing artifacts and review UI where verified.
- Classification: stage admission and evidence capture are real controls; test adequacy still needs judgment.

Proposed control 3: one review pass, one repair pass, then targeted verification or escalation.

- Enforcement point: review scheduling and reopening a completed stage.
- Minimum implementation: use a fixed review allowance for the task, with one initial review and one repair/verification round as a proposed starting policy, not an evidence-derived optimum. Require each blocking finding to identify the approved criterion or concrete safety defect, affected revision and reproduction or evidence. Store finding IDs and dispositions. Suggestions remain non-blocking. Verification checks the repair and relevant regressions; it does not automatically commission another broad review.
- User approval boundary: additional broad review or scope expansion needs approval. Unresolved blockers stop release and present choices: another bounded repair attempt, reduced scope with explicit acceptance, or handoff. Hitting the allowance never means ignoring a dangerous defect.
- Acceptance test: repeatedly return the same finding, then a renamed stylistic suggestion. The scheduler performs no extra broad pass. A genuine unresolved safety finding yields a paused, incomplete task with evidence, not a merge or an automatic third loop.
- Failure risks: models can relabel suggestions as blockers or invent new IDs. The hard round limit still holds, but a human may need to resolve classification. A too-small allowance increases interruptions. Repair verification must still cover induced regressions.
- Classification: scheduler limits are real controls. Finding classification is fallible. The precise review policy is our proposal, not a documented SDK feature.

### Gaps
The fetched sources do not establish an optimal number of review rounds. No proposed checkpoint or review control was implemented or tested here.

## How should budgets stop runaway work without abandoning the task?

### Takeaway
Budget exhaustion should change the task to an explicit resumable pause, not success, disappearance or an automatic retry with a fresh allowance.

### Cited Findings
- OpenAI's runner raises `MaxTurnsExceeded` when its configured turn limit is exceeded; turns mean LLM calls. `max_turns=None` disables the limit. Its documented error handlers can return controlled output for exhaustion. This is an implemented run-level bound, not a total wall-time or child-work budget. [Agents SDK running agents, rolling Python documentation](https://openai.github.io/openai-agents-python/running_agents/)
- LangGraph interrupts require a checkpointer and stable thread identity; production durability requires persistent storage. Resume re-executes the node, so side effects need idempotency or deduplication. These are implemented pause/resume facilities with operational requirements. [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)

### Inferences
Proposed control 4: task-level admission budget with a preserved handoff.

- Enforcement point: before scheduling the next model call, review or child task. Start with a host-owned aggregate turn allowance and the review allowance above. Do not introduce configurable knobs for every action. Add independent tool timeouts only where needed to prevent a hung command.
- Minimum implementation: persist consumed allowance and task status across resumes; account for child calls against the same task. Near the limit, request a checkpoint. At exhaustion, stop admitting new work and publish host-generated status from already recorded artifacts even if the model cannot produce a summary. Include the diff, last verified state, outstanding criteria, failures, and exact next action. Set status to `paused_budget`, never `complete`.
- User approval boundary: only the user grants an extension, accepts an explicit reduced scope or cancels. Resume must retain consumed allowance and the approved contract. No silent fresh-run reset and no automatic extension because the agent says it is nearly finished.
- Acceptance test: exhaust the allowance during an unresolved repair, restart the host and attempt a child spawn. Neither restart nor delegation creates free work. Existing edits and evidence survive, status remains incomplete, and a user-approved extension resumes the same task without duplicating a side effect.
- Failure risks: a turn bound does not cap latency, tokens or tool duration. In-flight work may finish after admission closes; account for it and collect results. Hard-killing commands can leave partial writes. Durable state alone does not guarantee safe resumption. Budget enforcement should be strict about new admissions and honest about outstanding processes.
- Classification: counters, admission checks and durable status are real controls. Prompt requests to finish soon are not. Adoption does not require importing LangGraph or the OpenAI SDK; borrow the small mechanism only if existing local facilities cannot supply it.

### Gaps
Source documentation was fetched, but no SDK release was pinned and no framework runtime was exercised. Pi equivalents, restart behavior and child-budget accounting remain unknown. The smallest first experiment is the contract plus one visible checkpoint and a bounded review transition, measured by time to first verified slice, approval interruptions and unresolved required work. These are proposed evaluation criteria, not reported benchmark results.

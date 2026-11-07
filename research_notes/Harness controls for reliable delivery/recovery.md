# Reliable delivery and interrupted-agent recovery

## What do existing tools actually guarantee?

### Takeaway
Persisted conversation, execution checkpoints, and diagnostic traces solve different problems. None alone proves whether an external command completed after a provider connection failed.

### Cited Findings
Five primary sources, fetched in this bounded pass. Version scope is the live, unversioned documentation below; Pi is explicitly its moving `main` branch. No installed-version compatibility or release pin was verified.

1. **LangGraph checkpointers:** snapshots persist at super-step boundaries; pending writes preserve successful sibling-node outputs when another node fails. Continue unfinished work with `invoke(None, config)` and the same thread, not fresh input. Historical replay re-executes subsequent nodes, including external API requests. `sync` commits checkpoints before proceeding; `async` has a crash window; `exit` cannot recover intermediate state after a process crash. These are checkpoint guarantees, not transactions with external commands. [Source](https://docs.langchain.com/oss/python/langgraph/checkpointers)
2. **LangGraph interrupts:** durable checkpoint storage and a thread ID support pause/resume. Resuming restarts the interrupted node from its beginning; code before the interrupt runs again. The same applies to the parent node invoking an interrupted subgraph. Approval does not eliminate the crash window after a side effect but before node completion; the docs explicitly require idempotency or external deduplication. [Source](https://docs.langchain.com/oss/python/langgraph/interrupts)
3. **Temporal activities:** a worker can finish a side effect and crash before reporting success, causing an activity retry. Completed activities recorded in history do not run again during replay. Temporal distinguishes completion observed exactly once from activity execution potentially occurring multiple times. Idempotency keys must be enforced by the called service. Timeouts detect missing completion; heartbeats communicate progress. [Source](https://docs.temporal.io/activity-definition)
4. **OpenAI Agents SDK tracing:** built-in traces cover model calls, tools, handoffs and custom events. Default export batches data in memory and sends it in the background; explicit `flush_traces()` is available after closing a trace. Sensitive inputs and outputs are included by default unless disabled. This source documents observability, not recovery of external processes. [Source](https://openai.github.io/openai-agents-python/tracing/)
5. **Pi sessions:** sessions save automatically unless `--no-session` is used. `--continue`, `--resume`, and `/resume` restore conversation sessions. Only the active branch supplies conversation history; compaction retains summaries and recent messages without deleting original entries. Persistent files therefore need not all be present in the next model context. The documentation also describes `/session` for identity verification and `/bug` for reviewed diagnostics. [Source, `main`](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sessions.md)

### Inferences
- Reuse existing session and event capabilities first. Add command reconciliation and delivery acknowledgements only where the actual integration lacks them. This is a proposal, not a claim that Pi has no such extensions.
- Treat retries as potentially at-least-once execution. An exactly-once completion record does not establish exactly-once external effects. Temporal's explicit distinction is the useful design constraint.
- A provider WebSocket disconnect establishes transport trouble, not child death, command failure, or missing filesystem writes. The incident's root cause remains unknown.

### Gaps
- These sources do not establish the installed Pi version, extension behavior, process ownership, or the reported disconnect's cause. No runtime was inspected.
- OpenAI session/resume semantics were not examined in this pass; tracing must not be presented as a substitute.
- The requested LangGraph durable-execution URL returned a general persistence page. The checkpointer and interrupt pages above supplied the detailed semantics. Two attempted Pi `docs/session.md` URLs returned 404; discovery located `docs/sessions.md`. Failed URLs: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md` and `https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/session.md`.

## What is the smallest useful recovery and reporting layer?

### Takeaway
Proposed new glue: derive a compact recovery record from durable events and command receipts, then display the last verified milestone. Do not rely on the model remembering to write a handoff before it fails.

### Cited Findings
- LangGraph exposes checkpoint identity, next tasks, task errors, interrupts and parent linkage, which are concrete inputs for an execution-state view. [Source](https://docs.langchain.com/oss/python/langgraph/checkpointers)
- OpenAI traces already distinguish tools, handoffs and model calls, but background export introduces observation delay. [Source](https://openai.github.io/openai-agents-python/tracing/)
- Pi restores the active conversation branch, not every persisted entry or file. [Source](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sessions.md)

### Inferences
The following is our proposed schema and policy, not an upstream feature claim:

1. **Persist a small event-derived checkpoint/failure envelope.** Include schema version, task and parent/child IDs, session identity, monotonic event sequence, attempt ID, last verified milestone and evidence, outstanding command IDs, artifact references, pending approval, next safe action, and sanitized failure category. Keep transport state, process state, command outcome and task outcome separate. Permit `unknown` explicitly. Atomically update the snapshot from committed events; do not overwrite a verified success with a later connection error.
2. **Give commands durable receipts.** Before launch, reserve a stable logical operation ID and record intent, cwd, input revision and a protected command digest. The launcher records process identity including host and process start identity, start time, then exit status, finish time and output locations. Publish completed artifacts with path, byte count and SHA-256 digest. A receipt verifies process outcome; artifact validation verifies output. Neither substitutes for the other.
3. **Persist handoff details independently of prose.** Save exact task scope, constraints, artifact manifest, checks actually run, unresolved decisions and next step. A human-readable summary can be generated from that record. A file merely existing is not a completed handoff.
4. **Report without waiting for model generation.** A supervisor emits updates on verified milestones, connection loss, stale heartbeat, confirmed exit, blocked approval and recovery. Display, for example, “Connection lost; last verified: tests exited 0 at event 42; command 17 outcome unknown; reconciling launcher receipt.” Distinguish a supervisor heartbeat from useful task progress. Deduplicate notifications by event ID and retain terminal notifications until acknowledged.

### Gaps
- Persistence medium and existing hooks need an integration audit. A local journal may suffice; this research does not justify adopting Temporal or LangGraph wholesale.
- Hashes establish byte identity, not correctness, provenance or execution success. Hashing a secret-bearing command is not adequate redaction; keep raw arguments and output private.
- Atomic file publication is not automatically power-loss durability. Storage ordering, concurrent writers and recovery of partially written records require tests before claiming crash safety.

## How should recovery avoid duplicate commands?

### Takeaway
Reconcile before rerunning. Unknown outcome is a blocked decision state, not permission to retry an irreversible operation.

### Cited Findings
- Temporal documents the exact ambiguity window: the external action succeeds, but its completion never reaches durable history. Service-enforced idempotency keys address duplicate effects across retries. [Source](https://docs.temporal.io/activity-definition)
- LangGraph warns that interrupted nodes restart and that post-approval effects can repeat after a failure. [Source](https://docs.langchain.com/oss/python/langgraph/interrupts)
- Buffered trace export means missing dashboard events cannot by themselves establish non-execution. [Source](https://openai.github.io/openai-agents-python/tracing/)

### Inferences
Proposed recovery decision table:

| Evidence | Safe next action |
|---|---|
| Completion receipt and expected artifact hashes validate | Restore recorded result; do not rerun merely because delivery failed. |
| Launcher confirms the same process is alive | Reattach observation; do not launch a second copy. A PID alone is insufficient because it can be reused. |
| No receipt, process absent, external outcome queryable | Query the authoritative destination using the operation ID, then reconcile. |
| Outcome unknown, operation safely repeatable | Retry under the same logical idempotency key, with a new attempt ID and exclusive ownership. |
| Outcome unknown, irreversible or non-idempotent operation | Stop and request human reconciliation/confirmation before any retry. Explain the possible prior effect. |
| Artifact exists but completion is missing | Validate content and provenance where possible; retain unknown execution status until reconciled. |

Additional proposal details:
- Reuse a stable operation ID across attempts; changing the key on retry defeats deduplication. Prevent concurrent recovery workers with exclusive ownership. A lease expiry alone does not prove the old worker stopped; use fencing where the destination supports it.
- Approval should bind to the exact operation and inputs, before execution. Human confirmation does not itself make a retry safe or undo an earlier effect.
- Logs can show reported events, not prove unreported events never happened. A silent stream does not establish process death; a live process does not establish progress; exit 0 does not establish the user's goal; persistent files do not establish model context or acknowledged handoff.
- Suggested acceptance tests, not run: sever provider transport during a long child command and verify no duplicate launch; kill the coordinator after an external effect but before its receipt and require reconciliation; lose a completion notification and redeliver it once acknowledged; mutate an artifact and reject its old manifest; resume after compaction and recover scope/check evidence from the envelope; attempt concurrent recovery and reject the second owner.

### Gaps
No code, runtime or configuration changes were made, and no acceptance tests were run. The deliverable is a public-source research note; any claim of safe automated recovery awaits end-to-end fault-injection tests against the actual launcher and destination systems.

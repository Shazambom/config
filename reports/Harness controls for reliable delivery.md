# Keep agent delivery bounded and verifiable

**Start with one agreed task boundary and one evidence-backed delivery checkpoint.** Add recovery reconciliation only where local fault tests expose a gap. These controls target scope expansion, misleading fixtures, ambiguous deployment status and interrupted subagent work without introducing another orchestration framework. They cannot decide whether an abstraction is necessary or make an agent's diagnosis sound. The proposals below synthesize public documentation; they are not tested Pi capabilities or approved implementation work. No local runtime was inspected and no acceptance tests were run.

## Freeze the requested outcome, not every edit

Anthropic's long-running-agent experiment used incremental work, progress records and end-to-end checks to counter premature completion. Its initializer also expanded a request into hundreds of features, which is the wrong default for this MVP constraint ([Anthropic](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)). Borrow the incremental checkpoint, not the expansion.

Our first proposed control is a short, user-approved task contract: one observable outcome, acceptance check, non-goals, permitted working area and accepted losses. The agent can propose changes but cannot approve them. Keep the authoritative version outside its writable state. Require the first verified slice to become inspectable before optional cleanup or new functionality. Reviewer suggestions do not redefine the assignment; unresolved required work stays explicitly incomplete.

Enforce objective restrictions only where dispatch coverage is verified. A path restriction cannot detect unnecessary abstractions within an allowed file. OpenAI's documented function-tool guardrails exclude built-in shell and patch tools, illustrating why a nominal gate is insufficient ([OpenAI Agents SDK](https://openai.github.io/openai-agents-python/guardrails/)). Locally, verify shell, child-agent and other mutation routes before calling restrictions enforced. Do not build a general sandbox merely to enforce this recommendation.

**Acceptance test:** request one behavior, then inject reviewer advice to add caching and rewrite the acceptance criterion. The original contract must remain unchanged, prohibited operations must not execute, and the original behavior must remain deliverable. A user-approved revision permits only the agreed expansion. If ordinary in-scope work is blocked, the control fails usability too.

## Make delivery claims depend on observed outcomes

Anthropic distinguishes an agent's transcript from the actual environmental outcome and recommends calibrating graders against known-working solutions ([Anthropic](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)). Independent tests can still be wrong: OpenAI documents benchmark tests requiring unspecified function names and extra functionality ([OpenAI](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)). Another reviewer or hidden fixture does not solve a malformed acceptance rule.

Our second proposed control combines a calibrated acceptance check with one runner-produced checkpoint. Record the tested artifact, exact command, fixture origin, raw evidence location and time. For deployment, separately report command completion, installed/loaded artifact identity, process liveness and the user-visible check, each as pass, fail, unknown or not run. Kubernetes documents distinct startup, liveness and readiness concepts; our delivery receipt is a proposed application of that distinction, not a Kubernetes feature ([Kubernetes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)). Reuse existing artifacts and review UI rather than add a service or database.

Run one harmless fresh challenge through the installed user entry point. A saved transcript proves persistence, not timely live delivery. A successful installer does not prove the running process loaded the new artifact. Report the last verified milestone without waiting for another model-written summary; a heartbeat must not count as useful progress.

**Acceptance test:** in a disposable environment, a known-good implementation passes and a disabled behavior fails. A constant-success fixture cannot satisfy the live check. Deploy an older artifact while keeping source correct; reject the mismatch. Break the real transport while leaving a stub healthy; never report feature-ready. Corrupt the observer separately; classify the result as observation failure or inconclusive, not a product diagnosis. Restore the ordinary route and require a fresh challenge to pass. These checks require local verification of the authoritative event source, identity fields and loaded-artifact observation method.

## Reconcile interrupted work before retrying it

Pi documents automatic session persistence and resume commands; only the active branch supplies conversation history ([Pi sessions, moving main](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sessions.md)). That establishes conversation recovery, not installed extension behavior or external-command recovery. Prefer existing Pi sessions, events and launcher receipts after verifying their local semantics. This research does not establish that Pi lacks any required mechanism.

Our third control is conditional: expose outstanding operations and reconcile their outcomes before rerunning them. A valid completion receipt restores the result; a verified live process is observed rather than duplicated. An unknown irreversible outcome requires authoritative destination checks or human reconciliation. Preserve scope, evidence and the next safe action across resume. Redeliver unacknowledged completion notifications with deduplication where needed.

Temporal documents the ambiguity window where an external effect succeeds before completion reaches durable history. Execution can repeat despite once-recorded completion ([Temporal](https://docs.temporal.io/activity-definition)). LangGraph likewise restarts interrupted nodes and requires care with repeated side effects ([LangGraph](https://docs.langchain.com/oss/python/langgraph/interrupts)). Neither justifies an exactly-once claim. A WebSocket error alone establishes neither child death nor the incident's root cause.

**Acceptance test:** sever transport during a long child command, then resume. Confirm the original process identity and no second launch. Kill the coordinator after a test effect but before its receipt; recovery must reconcile or pause, never blindly repeat it. Drop a completion notification and verify eventual acknowledged delivery without duplicate user-visible completion. Resume after compaction and confirm the task boundary and check evidence remain available.

## Conclusion

The MVP should make unsupported success claims harder and optional scope expansion visible, not automate every judgment. Agents remain responsible for checking observation methods, questioning fixtures and asking when uncertainty changes the decision. No receipt can prove that a requirement is sensible. Before implementation, verify existing Pi mechanisms and agree on the smallest failing scenario; add only the missing control demonstrated by that test.

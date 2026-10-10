# Pi session lifecycle lessons

Read this before changing saved-session ownership, terminal-loss handling, worker
shutdown, startup replay, or guard failure behavior. The implementation experience
recorded here used Pi 1.0.4 on macOS. Recheck API ordering on other versions.

Implementation and boundaries: [lifecycle README](../../pi/agent/lifecycle/README.md).
Acceptance contract: [lifecycle testing](../../pi/LIFECYCLE-TESTING.md).

## Settle the tradeoffs before building

The work expanded into memory-job preservation, recovery, and a replacement
launcher before the acceptable loss was settled. The user accepted losing
unfinished memory work when its owning terminal dies. That removed the need for
preservation infrastructure.

Keep the goal explicit: prevent competing saved-session writers, handle ownership
choices, stop abandoned runtimes and owned workers, preserve saved history, and
avoid touching unrelated processes. The replacement may become usable after the
old root exits; its old workers may take up to five seconds to stop. Do not turn
that bounded overlap into a recovery system without a new requirement.

## Prove the complete task path early

Component tests passed while a real resumed subagent lost its new task. Trace
launch, ownership resolution, fresh context, model input, response, and saved
history together. Assert the actual supplied task reaches the provider, not just
that a process starts or reports ownership.

In the failing trace, session replacement began during startup. The task reached
`before_agent_start` without reaching the input hook that should capture it.
Deferring the internal switch with `setImmediate` fixed the tested startup path;
`withSession` supplied the valid replacement context for replay. Public source
confirmed that extension commands execute before input hooks and streaming queues,
so `deliverAs: "followUp"` did not defer the switch command. See the
[tagged prompt implementation](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/agent-session.ts)
and [fresh-context example](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/examples/extensions/handoff.ts).

Do not generalize this into a guarantee that `setImmediate` waits for all async
startup work. Verify the actual ordering, preserve text and images exactly once,
and cancel deferred callbacks when their runtime becomes stale.

References: `pi/tests/lifecycle-guard/ownership.test.mjs`,
`pi/tests/lifecycle-guard/worker-owner.test.mjs`, and the real tool scenarios in
`pi/tests/lifecycle-team/worker-root.mjs`.

## Clean handoff still needs fresh history

A contender can load history before ownership admission. If the previous owner
writes another turn and then releases cleanly before the contender claims, there
may be no observed conflict. Treating only abandoned-owner recovery as requiring
a reload admitted stale context and could create a branch excluding saved turns.

Freshness must follow acquisition of prior ownership, including a clean release.
Check the provider's context and the saved parent chain, not merely file existence.
Regression: `pi/tests/lifecycle-guard/clean-release.test.mjs`.

## Separate requester restart from descendant cancellation

Cancelling the requesting child itself during `/reload` made its replacement
registration fail. Preserve the requesting runtime's ability to restart while
retiring its old launch admission before awaiting descendant cleanup. Keep
cancelled ancestors, delayed launches, and replacement incarnations fenced.

Also exercise `/new`, fork, and another process reopening the old session while
the first process remains alive elsewhere. Do not assume a same-file resume test
covers every replacement reason.

A separate resume bug retained a historical member with the same name as its
replacement. Recipient lookup checked ambiguity before eligibility and rejected
the advertised live peer. Apply the existing live/process checks before deciding
whether a name is ambiguous; multiple eligible matches must still reject.

References under `pi/tests/lifecycle-team/`: `reload.mjs`,
`root-replacement.sh`, `resumed-name.mjs`, and the actual child-reload scenario
in `worker-root.mjs`.

## Empty broadcasts must report no listeners

Team broadcasts appended the root audit copy even when no other member could
receive them, and the tool returned "Sent". Count eligible recipients before adding
that copy. Check live state and process identity, exclude the sender, and reject an
empty broadcast before appending it or consuming send quota. For a recorded PID,
require a known identity: two missing identities must not make a dead process count
as a listener. Independent review caught that case; its regression failed before
the identity-presence guard and passed afterward.
This is a tool error, not a peer acknowledgement, retry, or new agent turn.

`pi/tests/team-fixture.mjs` drives actual SDK orchestrator tool calls for empty,
completed, stale-identity, and exited-process teams. Assert that the next model
request receives the no-recipient response and the message log stays unchanged.
Use a real exited process for the dead-PID case; an out-of-range PID only tests an
OS argument error. Existing live peer and root delivery checks must still pass.
Run `bash pi/test-team.sh`; implementation lives in
`pi/patches/interactive-subagents.patch`.

## Fence the first shared mutation, not only launch

Arena changed team generation before its worker launch checked ownership. A later
rejection did not restore pending-message eligibility. Capture admission before
mutation and recheck it after lock waits. Cleanup after revocation must remain
limited to resources that operation actually owns, such as its suspension token.

Regression: `pi/tests/lifecycle-team/arena-admission.mjs`.

Do not fix similar-looking paths without inspecting the applied source. One review
claim about missing memory-result checks was false: the matching patched observer
and consolidator already checked admission after awaiting the worker. Mixing a
zero-context patch with older enclosing source produced the mistaken claim.

## Failure handling must preserve ordinary usage

An automatic investigation turn raced a supplied print request after genuine guard
initialization failure. The command exited with `Agent is already processing` and
never executed the task. Intentional stateless sessions also needed to be separated
from initialization errors.

Use the public `ctx.mode` contract. `hasUI` alone does not distinguish TUI from RPC.
TUI keeps a persistent warning and one deferred investigation. Print/JSON warn on
stderr; RPC reports through its protocol. Neither starts an unsolicited model turn.
Known ownership conflicts remain blocked. Intentional top-level stateless sessions
remain usable but do not grant ownership-dependent worker launch permission.

References: `pi/tests/lifecycle-guard/stateless.test.mjs`,
`pi/tests/lifecycle-guard/failure-startup.sh`, and
`pi/tests/lifecycle-deployment/persisted-failure.sh`.

## An idle timeout is not a request deadline

`socket.setTimeout` reset when partial response bytes arrived. The request exceeded
its advertised bound, and an admitted worker could remain alive beyond five seconds
after root exit while its owner check waited for a trickling response.

Use an absolute request bound. `AbortSignal.timeout` on connection creation provided
that bound without a separate timer framework. Verify both transport rejection and
actual worker exit. Measure elapsed time and distinguish server writes from bytes
received by the client; a requested sleep duration is not an elapsed measurement.

References: `pi/tests/lifecycle-guard/owner-client.test.mjs` and
`pi/tests/lifecycle-guard/worker-owner.test.mjs`.

## Terminal-query failure is not ownership loss

Two live sessions reported `SUPERVISOR_QUERY` at the same second. Read-only owner
probes still verified both writer leases, and tmux queries succeeded afterward.
The old monitor's outer catch permanently stopped polling. A private subprocess
timeout reproduced the diagnostic's generic code and empty sanitized stack, but
the historical trigger could not be proved because query details were discarded.

Keep terminal observability separate from the writer lease. Retain admission and
retry deadline-bounded queries with a capped delay. After sustained failures, send
one generation-fenced temporary status; after a complete valid reply, verify the
held lease and clear it. Failed, empty, or malformed queries never authorize root
signals. Real helper/lease failures remain failures. Do not automatically clear
those failures just because a later terminal-status message arrives.

Distinguish an uncertain reply from confirmed absence. The installed tmux manual
specifies that `list-panes -a` lists all server panes. A successful, nonempty,
fully validated reply containing only other panes establishes that the monitored
pane is gone. Keep orphan shutdown in this case. Independent review initially
flagged it, then withdrew the finding after checking that contract; a dedicated
regression now records the distinction.

`monitor-retry.test.mjs` exercises real helper IPC, repeated blips, longer timeout
and command-error outages, lease retention, autonomous recovery, and confirmed
terminal-loss shutdown. `monitor-status.test.mjs` checks the actual extension IPC
receiver, continued admission, warning restoration on reload, stale generations,
and separation from genuine ownership failures. `monitor.test.mjs` covers linked
clients and malformed/empty replies. These live under `pi/tests/lifecycle-guard/`.
`monitor-recovery-runtime.sh` verifies the actual installed CLI using a private
tmux-query override: real tasks before/during/after an outage, visible warning and
automatic clearance, unchanged helper PID and generation, and terminal-loss
shutdown afterward. Its optional argument selects the deployed guard path.
Wait for asynchronous diagnostic writes before asserting their UI warning; a
single event-loop tick is not a completion guarantee.

Old helpers already loaded in running sessions do not gain new code from deployment.
Do not signal or restart them without approval. The previously failed state remains
sticky; recovering those existing runtimes is separate from making new monitors
self-recovering. Independent subagent review can itself be blocked by that failed
admission state; do not bypass the protection to obtain a review.

## Keep feedback fast and check the test apparatus

Run one failing case first, then the smallest fix and related controls. Reserve
whole-suite runs for integration checkpoints. Reuse frozen dependencies when the
changed code does not require rebuilding them.

Some apparent failures were test setup errors: a non-executable adapter, path
aliases that defeated a provider's main-entry check, an omitted fixture, and using
repository source settings instead of deployed settings with resolved package
paths. Confirm the process, artifact, and observation method before changing the
product. Test the actual CLI loader and provider input; a direct module import or
a copied file alone does not prove deployed behavior.

Research is an escape hatch when progress stalls. Compare the exact symptom,
underlying API behavior, and broader design. Public research supported retaining
the helper and kernel-held lease rather than substituting heartbeat expiry or
server-wide tmux destruction. It also identified redundant identity work. Sources
were references to verify against the local runtime, not an instruction to redesign.

Deployment checks and rerun instructions:
`pi/tests/lifecycle-deployment/README.md`.

## Simplify measured work without weakening checks

The useful cleanups shared owner-request transport, removed a duplicate identity
query while retaining the authoritative helper's fresh check, cached only the
current process's immutable start identity, and reused a verified-unowned contender
helper. Team cleanup used one fresh state snapshot per check and batched retirement
of captured matching incarnations after successful cleanup.

Counter-based regressions showed the improvement without relying on subjective
speed claims. Do not cache foreign identity evidence or reuse an uncertain helper.
A module reshuffle that added a new cleanup contract was not worth the extra design.

References: `pi/tests/lifecycle-memory-stop/admission.test.mjs`,
`pi/tests/lifecycle-team/cleanup-reads.mjs`, and
`pi/tests/lifecycle-team/batch-retirement.mjs`.

## Report what the evidence actually proves

Passing acceptance tests did not cover every integration case. Independent review
found missing cases, and fresh verification also refuted an incorrect finding.
Keep both steps. Distinguish a source-established mechanism from a reproduced bug,
and an isolated deployment test from host deployment.

The implementation evidence covers private CLI/tmux scenarios on macOS. It does
not establish Linux execution or native GUI behavior. Native control-mode navigation
is refused rather than guessed. Existing uninstrumented runtimes are not retrofitted,
and stopping Pi workers does not promise rollback of external actions or termination
of arbitrary descendants.

Run focused regressions above during development. At an integration checkpoint:

```bash
bash pi/test-lifecycle-guard.sh
bash pi/test-lifecycle-team.sh
bash pi/test-lifecycle-memory-stop.sh
```

Use private histories, credentials, providers, terminals, and process inventories.
Verify cleanup. Keep raw evidence outside commits, and record the exact tested
artifact and remaining limits rather than claiming a later change had a full rerun.

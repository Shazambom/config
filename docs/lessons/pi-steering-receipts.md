# Pi steering receipts

## Settle the boundary before adding machinery

The accepted meaning is recipient **runtime input received**, not final model input.
An ordinary provider-request callback is an intermediate transform: later handlers
can remove its message. A final provider hook also needs cancellation, request-purpose
and observer-lifetime handling. Those mechanisms were unnecessary for the chosen
inbox boundary and were not promoted.

The simplified implementation in `pi/patches/interactive-subagents.patch` wraps
active steering in a small ID/assignment envelope. The existing recipient input
hook appends `subagent-message-received` to its saved session and restores the exact
original instruction. The sender reuses existing transcript scans and notification
paths. No provider changes, TeamStore receipt fields, queue or service are needed.

The input hook precedes queue admission and other processing. Do not describe this
receipt as successful queueing, model consumption, comprehension or completion.
Native `t3_thread_send` success alone proves only host acceptance; the Pi transcript
entry is the receipt. Bind it to the admitted member/incarnation/task/run and known
session file, never a display name or historical assignment alone. Do not inspect
native child output through `task_status` or parent thread reads to discover receipts;
those paths can consume completion delivery.

## Notice failure must not terminate child work

A synchronous receipt `sendMessage` error escaped `pollForExit.onTick` into the
completion watcher's cleanup catch, closing a healthy pane and deleting tracking.
Isolate notice errors from completion. Report the failure and leave pending state
and cursor unchanged for the next active scan. Native timer scans follow the same
rule. The fast-exit path also scans after `pollForExit` returns.

This is not durable notification recovery. If the standalone post-exit scan cannot
send, another scan is not guaranteed. Crashes, asynchronous persistence failures and
parent restart/reload can still lose a notice. Do not invent success or add a retry
service without a new requirement.

## Keep fixture sockets short and runtimes fresh

Deep private evidence paths can exceed Unix-domain socket limits. Keep the tmux
socket in a separate short system-temp directory, while retaining evidence at the
requested path. Check the observation path and cleanup before diagnosing delivery.

Use fresh Pi processes after deployment. Reload can refresh an extension entrypoint
while retaining cached imported modules. Neither a new conversation nor setup exit
proves that an existing process loaded the new behavior.

## Verification

`bash pi/test-steering-receipts.sh` reconstructs pinned source and exercises stock
CLI parent/child paths without credentials or paid inference. Node is used only for
upstream RPC/TypeScript and concurrent HTTP/SSE APIs; Bash owns orchestration.

The decisive assertion is a correctly correlated receipt in actual parent provider
input while the child still has one request and both original tools held. Then
release the tools and verify exact multiline input and both results survive.
Controls cover dropped forwarding, duplicates, stale launch/run identity, fast exit,
ACK-before-send-response ordering, and injected notice errors without child loss.
Controlled-native tests are not actual T3 backend proof. The installed-host control
is `pi/test-t3-runtime.sh --controls`, whose release barrier requires Sent followed
by the exact received receipt before releasing the held child request.

Active Claude raw steering, native question answers and completed-assignment requeues
retain their existing results without automatic received promises. macOS and the
qualified installed runtimes were exercised; Linux, arbitrary live-model behavior,
GUI rendering and general crash/restart recovery remain separate qualifications.

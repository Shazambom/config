# Steering runtime input receipts

Run without setup, deployment, real credentials or model inference:

```bash
bash pi/test-steering-receipts.sh
bash pi/test-steering-receipts.sh /path/to/new-evidence-directory
bash pi/test-steering-receipts.sh /path/to/new-evidence-directory /path/to/already-applied-source
```

The default downloads the checksum-pinned upstream archive and applies the repository patch in private state. An explicit source directory is read-only. The installed stock bundled CLI is resolved through `pi/command-path.sh` and invoked with explicit Node, not `pi.sh` or `init.sh`. Existing Node, jq and tmux are required; nothing is installed.

Bash owns selection, archive verification, environment isolation and short temporary socket paths. Node fixtures are necessary for concurrent HTTP/SSE and actual RPC/TypeScript tool execution. Each case has a fresh HOME/agent/session, synthetic credentials and loopback provider. No user settings, auth or sessions are copied. This is an allowlisted environment, not an OS network sandbox.

## Cases

`standalone.mjs` launches an actual parent RPC CLI and actual tmux child through the production tools. It covers:

- Positive received receipt at parent provider input while both child tools remain held and only one child provider request exists.
- Exact multiline original instruction and both parent/child tool results surviving afterward.
- Same-assignment duplicate input producing one recipient record and parent receipt.
- Dropped tmux forwarding and old-launch envelopes producing no receipt.
- A synchronous receipt-notification error retaining healthy child PID, pane and tracking; the next watcher scan retries once.
- Fast exit with tick receipt scanning disabled in a private control copy, proving the scan after `pollForExit` returns.

`native.mjs` uses actual parent/child Pi CLIs and the existing controlled T3-host pattern from `pi/tests/t3-adapter/leaf.mjs`. It covers positive, dropped forwarding, obsolete run, fast retired child before host send response, and notification-error retry. Host acceptance without the Pi input hook must not produce received. Saved Sent must precede received, including the fast race. Both original child tool results survive with no recipient receipt tool or extra turn. Team messaging stays OFF.

Native receipts read only known admitted session files. The fixture rejects `task_status` and parent reads of child output, which could consume completion. Self identity reads and child-authenticated lifecycle waits remain allowed. This fixture is not the real T3 backend. Use the existing installed-host `pi/test-t3-runtime.sh --controls` with explicit candidate settings for that separate proof.

## Evidence and limits

The printed directory retains provider payloads, sessions, raw RPC output, held-input proofs, notification attempts, source identity and cleanup receipts. Each successful case checks actual owned-process exit/liveness and server closure. Standalone also checks private tmux disappearance. The socket directory is separate and short even when evidence paths are deeply nested. Abrupt termination of the test driver is not a general descendant-supervision guarantee.

Received means runtime input observed, not queue admission, model consumption, comprehension or completion. Active Claude, question answers and completed-assignment requeues keep their existing fallback results. Source tests do not establish live-model reliability, GUI behavior, real managed-guard failure handling, Linux execution, restart recovery or exactly-once crash behavior. A failed standalone post-exit notice has no guaranteed future scan; this suite does not add recovery machinery.

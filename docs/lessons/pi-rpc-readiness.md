# Pi RPC readiness lessons

These are client-neutral runtime contracts. Host-specific behavior belongs in an
opt-in adapter, not Pi's RPC dispatcher. The implementation is repo-owned and
version/hash gated; it does not modify T3.

## A successful ACK was not proof of the selected runtime

The ownership guard's queued freshness replacement could retire the runtime that
accepted RPC input or model/thinking/name updates. Tests with event-driven replies
reproduced both lost input and successful ACKs followed by old runtime values.
Polling the response every 10 ms masked the race by spacing client commands.

Public input hooks do not cover registered commands or metadata setters. They also
swallow errors rather than reject the original RPC request. A pre-model hook runs
after automatic compaction. Do not bolt retries onto those hooks or infer readiness
from a successful `get_state` on the unpatched runtime.

The patch emits error-propagating `rpc_ready` before dispatch and after external
session changes. Its immutable event identifies command, phase and AbortSignal;
it does not replay caller payloads. UI responses and abort remain serviceable.
Held requests cannot migrate into a different session. Consumers may distinguish
read-only discovery from inference admission. This is not a firewall around
arbitrary autonomous work performed by trusted extensions.

The fixed readiness deadline is a code constant. Expiry must not dispatch later,
release an otherwise valid writer lease, or claim the task was handled. Missing
native support is not an authorization grant. `ctx.rpcReadiness` identifies the
patched API; supported launch paths also verify all native assets before execution.

## Cancellation must outlive the model loop

The low-level agent clears its active signal before `agent_before_settle`. An
extension awaiting children there could therefore hang `abort()`, which waited
for that extension to return. The patch gives the boundary its own operation
signal, aborted by stop, replacement and teardown. `continue:true` requests real
inference and must not be used as a keepalive.

Settlement must carry the finishing run's actual abort outcome. Capture it before
awaited handlers/deferred work, and reset it per run. Tests prove both external
abort and hook-requested abort report true, later successful runs report false,
and successful commands do not fabricate settlement events.

## Commands need their own tool scope

Exposing nested tool execution unchanged failed on empty history because the
existing helper required a previous assistant message. Do not invent an assistant
or transcript tool result to satisfy that precondition.

Command execution reuses argument validation, permission/result hooks and nested
execution under a command-owned lifetime. `ctx.executeTool` returns the actual
outcome; abort, handler completion and replacement close authority. Late calls
must refuse, and replacement `withSession` callbacks must not inherit old command
authority. Tool hooks must tolerate the explicitly absent assistant metadata for
command-origin execution. Normal model-origin execution retains its metadata.

## Verify the actual artifact and dependency ownership

The installed CLI executes a bundle, while SDK consumers can use unbundled files.
The helper verifies both and their declarations, plus the agent-core type contract.
Unknown, mixed or unsupported assets refuse mutation. Check mode is read-only.
A private candidate must copy patched dependency assets: a symlinked `node_modules`
can otherwise turn an isolated test into an edit of the active installation.
Use `pi/tests/rpc-readiness/copy-package.sh` for candidate construction.

Deployment exposed a gap in isolated tests: an installation beneath a Git root
made `git apply` silently skip staging-relative paths. Output hashes correctly
refused installation, while top-level setup continued with a warning. Clear
inherited Git context and set the staging directory's parent as Git's discovery
ceiling. The deployment regression now creates a surrounding Git repository.
Check the selected runtime with `--check` after setup; setup exit zero alone is
not deployment success. Report this kind of failure immediately.

A suspected alias bug did not reproduce. Real CLI `--session <symlink>` and RPC
`switch_session(<symlink>)` retained the lexical alias while loading fresh canonical
history. Keep the regression; do not add canonicalization machinery without a
failing case. Explicit client switches still cancel held requests.

Sources and checks:

- `pi/patches/rpc-readiness.patch`, `rpc-readiness-bundle.json`
- `pi/rpc-readiness.sh`, invoked by `pi/setup.sh`
- `pi/agent/lifecycle/session-lifecycle.ts`
- `pi/test-rpc-readiness.sh`, `pi/tests/rpc-readiness/`
- Lifecycle guard, team and memory-stop suites on the selected private candidate

Evidence covers Pi 1.0.4 on macOS with synthetic histories, real bundled CLI and
scripted providers. Do not infer Linux behavior, universal extension compatibility,
or actual host integration from these tests. Native changes require a new process;
do not restart unrelated user sessions during deployment.

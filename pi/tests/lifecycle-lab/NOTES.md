# Maintainer notes

## Scope

This directory builds test resources only. It changes no installed Pi package or deployed configuration. It does not implement terminal lifecycle protection. `OPERATIONS.md` and `lab.sh help` are the operator handoff; this file is not part of a blind QA brief.

The controller resolves the active `pi` command through `pi/command-path.sh`, or an explicit executable/package through `.bin.pi`. It never assumes a `dist/cli.js` location. `create --extension PATH` explicitly loads a trusted extension (repeatable), while the default stays bare Pi. Both product scripts forward these creation options. Each lab retains `cli.json`, `version.txt`, and `hashes.txt`, including bundle JavaScript, selected extension entry points and lab fixture hashes; additional extension dependencies need their own recorded hashes. Record these alongside results when comparing candidates. A running provider keeps the code loaded at creation; create a new lab after changing fixtures. Every control invocation also records the controller's current SHA-256 so later commands cannot silently inherit the creation-time hash.

Reuse audit: `pi/test-tmux-parent.sh` supplied the existing resolution/private environment/local-provider pattern. Its detached-only baseline and optional native GUI adapter are not suitable here. Its provider's Node TCP guard informed the local fixture; its subagent/tool protocol was not reused. `tests/common.sh` is deliberately not sourced because it runs setup and removes evidence. No setup/init, native terminal API, clipboard operation, or real conversation history is used.

## Isolation and ownership limits

Resources live under `/tmp/pi-lifecycle-UID/lab.RANDOM`. The short fixed parent avoids Unix-domain socket path limits, especially on macOS where the system temporary directory can be long. macOS and Linux provide `/tmp`; the inventory must be owned by the invoking user with mode 0700. Evidence is retained there, so copy it before OS temporary-file pruning if needed. Ordinary test summaries also use the system temporary directory.

Every tmux call supplies the private socket explicitly. Attached clients use Python stdlib PTYs, not a host terminal. The client answers fixed OSC 4/10/11 color queries across split reads. It records untouched output in `terminal.ansi`, actual reply bytes in `terminal-input.ansi`, and reply timing in `terminal-responses.jsonl`. It ignores clipboard commands and other control-string side effects. PTY setup and ownership of a child that must be reaped justify the small Python helper; Bash and jq handle orchestration. A Node HTTP fixture speaks the actual OpenAI-compatible streaming API. A small Node process-presence helper distinguishes the OS ESRCH result from permission/query failures; Bash's signal-zero exit status does not preserve that distinction.

An actor receipt records PID, start identity and launch command with a per-run path. Pi changes its process title; its liveness check therefore also verifies the private cwd. Each Pi incarnation has a separate randomly suffixed cwd stored in its receipt; independently opened instances share only the explicitly named saved file. A stale receipt cannot substitute another live incarnation with the same process title and start-time resolution. Old live receipts without an incarnation cwd fail closed; they are not silently upgraded. Start identity from `ps` has platform-dependent precision. This is not a race-free OS process handle or protection against hostile same-user filesystem mutation.

Environment sanitization and the Node loopback TCP guard are not an OS sandbox. They do not prevent a malicious candidate from reading host files, spawning arbitrary code, or bypassing Node TCP. Run only trusted candidates and synthetic inputs. The public input/key allowlists exclude shell, editor, login, browser, selection, paste, and clipboard operations. The test provider never emits tool calls.

Creation, attachment, and opening arm bounded failure cleanup before launching resources. Actor and tmux launch receipts are retained before later validation. A candidate's verified exit is a product observation, not a controller failure. A genuine open/fresh launcher failure rolls back only that attempted instance, preserving other owners. Creation/attachment failures use whole-lab cleanup. Explicit cleanup preflights every actor before any signal, including server teardown that could indirectly kill a child. It also rechecks each identity before TERM, waits up to three seconds per actor, then checks identity before KILL and waits up to two seconds. Ambiguity fails loudly and stops further signaling. Each actor gets its own bound; total cleanup scales with the finite inventory. A controller killed uncatchably or a tmux process that creates resources but never returns a launch receipt remains outside these ordinary failure-path guarantees. The controller retains evidence on failure and does not claim a sandbox or crash-proof resource transaction.

## Product observation

`pi/test-lifecycle.sh` first requires a real attached client and a visible, persisted fake-provider reply. It checks that detaching one of two clients and switching between two windows leave Pi alive. It then detaches the last client and gives Pi five seconds to exit, including a final status query. Status observes the actual process identity; pane disappearance is not the exit criterion. It checks saved user-visible text before any emergency cleanup. Failure is recorded before cleanup starts.

`pi/test-lifecycle-lab.sh` checks active and candidate executable/package resolution, foreign resource rejection, private attached clients, independent same-history instances, and bounded cleanup on injected create/attach/open failures. `test-stream.sh` verifies visible 15-second streaming, Escape cancellation, natural completion, saved output and closing a client during active streaming through the actual app. `test-exit-race.sh` deterministically closes a private client between process samples and checks that live identity mismatches and process-query failures leave an owned provider sentinel unsignaled. Pi documents Escape as abort; Ctrl+C clears the editor and is not an equivalent cancellation test.

`pi/test-lifecycle-ownership.sh` observes the shared saved file and provider request count for five seconds while the first owner is idle and a second instance opens. An explicit ownership prompt is only a candidate protected state: unchanged conversation content, no new request and continued first-owner usability are also required. The user-approved extension boundary permits native startup `session_info`, `model_change` and `thinking_level_change` entries; only these are excluded from the content digest. Raw before/after files are retained. `test-relaxed-startup.sh` validates this allowance using a deliberately limited reference refusal extension in the actual CLI, while the unprotected baseline still fails for accepted competing work. `test-extension-loading.sh` proves explicit extension loading and a subsequent visible/persisted provider response. It never authorizes takeover. Before probing ordinary chat, it positively identifies the native editor by observing a literal draft between its two borders with the model footer. Unknown screens are inconclusive. If overlapping work is accepted, it records raw JSONL entry order separately and probes a subsequently resumed actual CLI's model context. It does not use a mutating SDK reader or equate an absent active-branch message with physical deletion.

Both product scripts use exit 0 for a completed passing observation, 1 for an established product failure, and 2 for infrastructure errors, cleanup failure or inconclusive observations. `test-outcomes.sh` checks invalid-candidate classification. `test-startup-outcome.sh` uses a trusted candidate wrapper to reject one fresh incarnation, then injects a genuine window-launch error; both must leave the original owner accepting and persisting work. `test-incarnation.sh` substitutes a live second instance into a stale first-instance receipt and proves cleanup sends no direct or indirect signals.

History chronology is a periodically sampled content-hash observation, not an exact timestamp for each filesystem write; controller work adds to the requested interval. Provider events distinguish request receipt, stream acceptance, chunks, natural completion and an early closed connection. The latter proves connection closure, not its root cause. ANSI output is retained per private client. A response receipt alone is not proof of UI rendering or persistence; tests inspect both separately.

## Exit-observation regression

A client can exit after a successful process-state sample but before the next start-time sample. The original controller treated an empty failed start-time query as a changed identity. The retained failing reproduction is `lab.8Xz73plc/exit-race-error.txt` under the inventory. The controller now takes start identity and argv from one process snapshot and confirms absence through OS ESRCH, not any arbitrary failed ps/lsof query. A changed or unverifiable live actor still fails closed.

During the QA blocker inspection, client PID 32942 and its helper had already exited. The close event and private helper exit receipt were present; the server and Pi identities still matched. No historical snapshot from the failed query exists, so the original QA error cannot be attributed conclusively. Normal-exit sampling is reproduced independently; no evidence of a changed live QA identity was found. No QA receipt was rewritten or re-established.

## Terminal-query fixture and tmux crash

`test-terminal-queries.sh` checks fragmented query parsing and actual private-PTY
exchanges, including exact captured bytes and ignored side effects. The parent
independently reran it and the reference-refusal test successfully.

A failed refusal run in `lab.8X4dxr1t` lost its server. The macOS crash report
matched server PID 48571 and showed SIGSEGV through `bufferevent_write` and
`input_request_timer_callback`. The client had left color queries unanswered.
In tmux 3.7c, [pane-death cleanup](https://github.com/tmux/tmux/blob/3.7c/server-fn.c#L325-L373)
frees the pane bufferevent while a retained input context can still use its copied
pointer in [the queued-reply timer](https://github.com/tmux/tmux/blob/3.7c/input.c#L3375-L3389).
Answering supported queries makes the fixture behave more like a terminal; it
does not fix that upstream lifetime bug or guarantee crash immunity. A server
crash remains an infrastructure error, never a lifecycle pass or failure. No
installed tmux changes, exit delays or hidden retries belong to this correction.

## Coverage boundaries

- Relevant clients in the current product test all attach to the session containing the Pi pane. An unrelated session on the same server is not tested.
- Window switching is covered. Native tabs, GUI closing, pane-switch controls and OS sleep are not covered.
- `fresh` creates independent processes on the same saved conversation; it does not implement or assert writer takeover. `reconnect` only shows a known live instance. `open` allocates an instance with the conversation's name and rejects an already-used name. After quitting, resume with `fresh` and a new instance name.
- `saved` lists raw user/assistant entries from the originally assigned conversation, not necessarily the active branch restored by Pi. In-app `/new` or `/resume` can change the active session; use its visible UI for that session. The lab does not clone real histories.
- Ownership protection, takeover consent and rejection UX have not been implemented or validated against a protected candidate. The ownership regression recognizes a limited English prompt shape and the observed baseline editor; other screens are inconclusive. Different private cwds also mean these instances are distinct Pi projects opening one explicit saved file. Same-project ownership is a future case.
- Independent QA observations belong to their recorded earlier fixture revisions. They are not validation of later launcher/identity refinements.
- Noninteractive model/helper fixtures are not proof of any memory-job exemption. No memory lifecycle behavior is asserted.
- macOS execution is verified here. Linux branches are written for portable Bash 3.2 and standard utilities but still need a Linux runtime check.
- These fixtures do not deploy production changes. The approved implementation uses an extension and external supervisor, permits brief startup overlap, fails open with prominent diagnostics on guard initialization failure, and leaves restarts to the user; no native patches are planned.

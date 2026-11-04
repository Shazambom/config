# Installed CLI wake acceptance

Run the focused one-shot check:

```bash
bash pi/test-wakeups-runtime.sh
```

Run every CLI scenario with a fresh evidence directory and an optional trusted candidate entrypoint:

```bash
bash pi/test-wakeups-runtime.sh "$(mktemp -d)" pi/agent/wakeups/index.ts all
```

The full run takes several minutes, including two actual UTC minute boundaries. It requires the lifecycle lab's installed Node, Pi, tmux, jq and Python dependencies. It does not deploy anything or use authenticated inference. Candidate paths can point to an isolated `init.sh` deployment; every runner records the actual candidate and installed CLI identity.

## Cases

- `run.mjs`: one six-second reminder, idle settlement before its deadline, exactly one autonomous provider request, and one ACK on the saved active parent chain. Its wrapper allows only `wake_after`.
- `cli-timers.mjs`: all six frozen declarations, one automatic three-second interval registration, at least three deliveries, timer listing, selective cancellation before deadline, unknown-ID rejection, two real minutely UTC cron ticks, and an eleven-second busy provider turn. Recurring ticks must coalesce without interrupting that turn or losing the original user task.
- `cli-shell.mjs`: silent immediate exit 0 and numeric 137, silent exit 7, actual SIGTERM, `textDone` before delayed exit, trailing output, separate 4096-byte tails with dropped-byte accounting, and a finite descendant retaining pipes. The direct shell must report termination within a bounded drain window and mark incomplete output. Each saved receipt must precede exactly one saved exit notice. Temporarily renaming only the private instance cwd induces an actual OS launch failure, which must return an ordinary `LAUNCH_FAILED` error without a handle or later exit event. The cwd is restored before fixture cleanup.
- `cli-lifecycle.mjs`: native `/reload` and `/new` discard old unsent jobs. A fresh task verifies the new runtime and saved active branch. The separate private `cli-deny.ts` fixture adds a conflicting admission response while the genuine guard remains loaded. Both dispatch and new registration must reject ambiguous admission. The observer does not inject this fault.
- `cli-modes.mjs`: actual RPC JSONL prompt/response, autonomous wake and ACK on stdout; actual `--print --mode json` rejects registration and exits without a later wake. The private PTY supplies RPC stdin records, not TUI prompts. A forwarding stdout recorder preserves bytes without replacing the runtime protocol. The lab's separate `--version` discovery output is excluded from that protocol recording.
- `cli-owned.mjs`: normal `/quit` and controlled SIGKILL of the private inventoried root. Before SIGKILL, the test checks lab status, PID, start identity and unique cwd, then records the immediate identity snapshot. Actual foreground and ordinary descendant liveness, the anchored process group, and an unrelated lab-provider sentinel are checked before fixture cleanup. Product cleanup cannot pass merely because lab cleanup later kills actors.

Individual commands:

```bash
node pi/tests/wakeups-runtime/cli-timers.mjs "$(mktemp -d)" [candidate]
node pi/tests/wakeups-runtime/cli-shell.mjs "$(mktemp -d)" [candidate]
node pi/tests/wakeups-runtime/cli-lifecycle.mjs "$(mktemp -d)" [candidate]
node pi/tests/wakeups-runtime/cli-modes.mjs "$(mktemp -d)" pi/agent/wakeups/index.ts rpc
node pi/tests/wakeups-runtime/cli-modes.mjs "$(mktemp -d)" pi/agent/wakeups/index.ts print
node pi/tests/wakeups-runtime/cli-owned.mjs "$(mktemp -d)" pi/agent/wakeups/index.ts quit
node pi/tests/wakeups-runtime/cli-owned.mjs "$(mktemp -d)" pi/agent/wakeups/index.ts kill
```

The extended wrappers allow all six tools and no builtins. The loopback provider requests tools and acknowledges actual CLI requests. It never sends wake messages, advances time, or fabricates process exits. The observation extension records events and admission without tools, continuations, jobs or timers. Expected results come from the frozen contract and fixture commands, not provider success flags.

## Evidence and limits

Evidence includes provider requests, monotonic observations, CLI identity, candidate path, assertions, live process checks and inventory-based fixture cleanup. Lifecycle and shell tests inspect saved active ancestry, not merely file existence. Custom notices are persisted as `custom_message` entries, not ordinary `message` entries. Provider content can be strings or text blocks; extract text before parsing payload JSON.

The initial REDs were actual `Tool wake_every not found` and `Tool watch_shell not found` errors. All scenarios have passed against the source entrypoint on the current macOS host. This is not Linux execution proof. Environment isolation and the lab's network guard are not an OS sandbox.

The owned-command tests cover ordinary foreground work in the helper's process group. They do not promise containment of daemons, new-session/group escapes or a malicious helper. Helper supervision loss, host suspend, persistence, live-model behavior, and capacity exhaustion are not covered by these CLI cases. RPC/print coverage is a one-shot registration/delivery or rejection check, not every timer and shell scenario in every mode.

## Focused runtime tests and negative controls

`node --test pi/tests/wakeups-runtime/runtime.test.mjs` runs the production controller with real timers and an API fixture. Timer and shell test files provide additional focused coverage; they do not replace the installed CLI path.

For counterfactual checks, copy the production source into a private directory. Loading a private candidate with `triggerTurn: false` through `run.mjs` must fail the autonomous-request assertion even though a notice is saved. This control has been rerun against the expanded implementation and failed with two provider requests instead of three. Never mutate the deployed extension or change expected results to obtain a pass.

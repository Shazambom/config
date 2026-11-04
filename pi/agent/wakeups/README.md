# Runtime-local wakeups

Six model tools:

- `wake_after`: a delayed one-shot reminder.
- `wake_every`: fixed-rate elapsed-time recurrence, registered once.
- `wake_cron`: five-field numeric cron in an explicit IANA timezone.
- `wake_list`: current timers, not process discovery or history.
- `wake_cancel`: cancel future ticks and unsent local notices; cannot recall a submitted notice or kill a command.
- `watch_shell`: launch a foreground command and report its actual direct-shell exit with bounded output.

## Configuration and lifetime

The `./wakeups/index.ts` entry in `pi/agent/settings.json` controls activation;
place it after the lifecycle extension. Apply repository changes with
`./init.sh --pi`. Setup copies the resources and links the lockfile-pinned
calendar dependencies. Do not edit deployed files or install dependencies by hand.
New Pi runtimes load the configured extension; setup does not restart existing
sessions.

Tools require a live, owned saved session in TUI or RPC mode. Ownership and the
local runtime incarnation are rechecked before asynchronous effects. Close,
reload and session replacement cancel runtime-local work. Jobs are not restored
from history. Print/JSON one-shot CLI modes reject background registration.

## Timers and delivery

Elapsed waits use monotonic deadlines and bounded native timeout chunks.
`next_at` is a wall-clock estimate for elapsed timers. Cron uses wall time and
rechecks its deadline periodically. Suspend behavior is not qualified.

Intervals advance arithmetically after missed periods. Recurring notices
coalesce while the agent is busy rather than replaying a backlog. Native
follow-ups do not interrupt the current user task. Scheduled and submitted jobs
have bounded capacity. Pi's `message_end` marks entry into message flow, not a
durable-save or model-consumption acknowledgement. Async send errors use Pi's
extension-error channel; unconfirmed work is not blindly retried.

Cron evaluation uses the pinned cron-parser/Luxon pair, not custom calendar
arithmetic. Duplicate expanded values are rejected, including `0,7` for Sunday;
use either `0` or `7`. Explicit numeric offset zones are rejected. DST follows
the evaluator's tested behavior, which differs between full-hour and half-hour
transitions and between retained and fresh overlap iteration. After missed
ticks, evaluation restarts from wall-now and must return a strictly future date.
There is no uniform “skip every gap/repeat every overlap” promise.

## Commands and cleanup

Shell choice comes from Pi's public `getShellConfig`. Commands run in the
current working directory, without a PTY. A running receipt precedes the later
exit event. Spawn failure is a tool error, not a fabricated exit. The event has
exactly one termination field: numeric `exit_code` or actual `signal`.

Separate byte-bounded stdout/stderr tails are drained continuously. Printed
“Done,” silence, and a requested signal do not establish exit. A bounded drain
after direct-shell exit marks output incomplete if descendants hold pipes open.
The direct shell's exit does not mean every descendant finished naturally.

Each launcher anchors its own POSIX process group. On completion, shutdown or
root IPC loss, the live launcher terminates its own group with bounded escalation.
The parent never signals a cached process-group ID. Ownership loss also requests
cleanup. Node preload hooks are removed from the launcher and preserved for the
user's command instead.

**Limits:** cleanup needs a responsive launcher. Launcher death/hang can leave
commands running; status and cleanup are then unknown, not reported as successful.
Descendants escaping into new process groups/sessions are not contained. This is
not a daemon supervisor, service recovery system, or arbitrary-PID watcher.
Unfinished results may be discarded during shutdown. Windows is not supported;
Linux behavior still needs execution on a Linux host.

## Verification

- `node --test pi/tests/wakeups-runtime/*.test.mjs`: controller, calendar and real-process failure controls.
- `bash pi/test-wakeups-runtime.sh "$evidence" "" all`: complete installed-CLI suite with real clocks/processes and a loopback provider.
- `bash pi/tests/wakeups-deploy.sh "$private_pi_home"`: activation and deployed dependency resolution after isolated `init.sh`.
- `pi/test-wakeups-sandbox.sh`: isolated model tool-use study; time and processes there are mocked, unlike the runtime suite.

See `pi/tests/wakeups-runtime/README.md` and `docs/lessons/pi-wakeups.md` for
assertions, failure controls and evidence limits. The installed runtime tested
here is Pi 1.0.4 with Node 22.23.2 on macOS.

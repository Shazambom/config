# Subagent completion

## Live failure

A post-reload smoke test launched nine real scout agents concurrently. Seven
completion notifications arrived. Two saved the exact requested final replies
with `stopReason=stop`, then their Pi processes exited, leaving idle zsh panes.
The parent still listed them as running.

The deployed watcher checked a session `.exit` diagnostic file or an
`__SUBAGENT_DONE_<code>__` marker captured from the terminal. Clean completion
created no diagnostic file. Neither stuck pane had a marker in bounded ordinary
or joined-line captures. The cause of the missing terminal text was not proved.
The numeric process exit codes were not recoverable from the final replies.

The two test panes were closed only after checking their recorded pane IDs and
shell PIDs, confirming `pane_current_command=zsh`, and finding no child processes.
No exit record was fabricated. Closing a pane alone cannot repair an old watcher
that catches missing-pane errors and continues waiting indefinitely.

## Required proof

A final model message, an activity label saying done, or an empty pane is not a
process exit receipt. Completion must survive terminal text being cleared and
must not fire just because an active child prints a sentinel-shaped string.
Test fresh launches and resumes, actual shell exit status, provider-error details,
stale records from earlier launches, and parent notification plus pane cleanup.
Use a full installed-CLI child with a synthetic provider, not only a replacement
actor that records command arguments. The earlier capacity tests covered that
narrower dispatch path; they did not prove full child completion.

## Implementation and corrections

The `index.ts` and `tmux.ts` changes in
`pi/patches/interactive-subagents.patch` give each Pi launch script its own
`.status` file. The script installs an EXIT trap before its preamble and publishes
its numeric shell status by temporary file plus rename. Fresh launches and resumes
use distinct script names. Receipt-backed polling ignores terminal markers.
Provider `.exit` diagnostics keep their existing failure path and can report an
error before process exit; those are not successful shell-exit confirmations.
They remain session-scoped, unlike the new per-launch shell receipts.

Bash's EXIT trap reported stale status zero when an owned test shell received
SIGHUP. Explicit HUP, INT and TERM traps preserve nonzero interruption statuses.
The SIGHUP regression must not accept a successful exit merely because the
previous command succeeded.

Successful, validated tmux inventory can establish that a pane disappeared.
Without a receipt, report unknown exit rather than success. Failed or malformed
queries do not establish disappearance. Keep provider diagnostics when they race
that inventory check.

An initial blanket catch around pane closure hid a failed `kill-pane`, deleted
tracking, and reported success while leaving the pane open. The parent identified
this after the initial automated review missed it. A real-command failure
injection reproduced it. Skip closure only for a confirmed-absent pane; other
close errors retain the existing cleanup retry and failure reporting.

## Verification

Run `bash pi/test-subagent-completion.sh`, or add `all <package-root>` to exercise
an already-applied package. The test uses actual installed child CLIs and a
scripted loopback HTTP provider. A barrier holds the real terminal capture until
the children exit and their terminal contents are cleared. Check the notification
and pane count, not merely the presence of a receipt. `screen-only` is a negative
control and must fail at the missing-notification assertion.

Coverage includes fresh/resume 0 and 23 exits, provider errors, ask-question/answer
without premature exit, nine simultaneous child completions, cleanup failure,
early shell exits, SIGHUP, malformed receipts, stale prior shell receipts and
screen markers, confirmed missing panes, transient tmux errors, and legacy/Claude
sentinels. Related suites are `pi/test-subagent-capacity.sh`,
`pi/test-subagent-provider.sh`, `pi/test-team.sh`, and `pi/test-lifecycle-team.sh`.

The parent notification receiver is an API fixture, not a native parent model
turn. Arena shares the launch/watch path but has no dedicated new case. macOS and
Pi 1.0.4 were exercised; Linux and native GUI rendering remain unverified. A shell
killed before it can publish, or an unwritable receipt location, cannot supply an
exit status. Confirmed pane disappearance reports unknown; this is not a general
process supervisor. Existing in-memory watchers need reload to be replaced.

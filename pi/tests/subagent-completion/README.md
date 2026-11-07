# Subagent completion regression

Run `bash pi/test-subagent-completion.sh`. It downloads checksum-pinned upstream
source and applies the repository patch in a private directory. To test an
already-applied package without changing it:

```bash
bash pi/test-subagent-completion.sh all /path/to/package-root
```

The runner discovers the active Pi CLI through `pi/command-path.sh`. It requires
repository Node test dependencies, tmux, and the existing Bash bootstrap tools.
JavaScript exercises the SDK/TypeScript APIs and the HTTP provider protocol; it
does not add a runtime dependency. Normal HOME and credentials are not used.

Actual child CLIs receive exact tasks through a scripted loopback HTTP provider.
The parent uses the production tool executors and watcher, with real SDK session
and model state. An API fixture receives the resulting notification calls. A
private tmux-command wrapper holds capture at a barrier, then executes the real
capture after child exit and terminal clearing. It does not return a fabricated
screen. All nine burst children must be alive before their responses are released;
all nine matching results and pane closures must follow.

The full suite includes fresh/resume statuses 0 and 23, provider errors,
ask-question/answer, genuine pane disappearance, interrupted launch shells,
malformed/stale shell receipts, premature terminal markers, legacy sentinels,
transient query failures and failed pane cleanup. A failed close with the pane
still present must reach cleanup retry and error reporting, not silent success.

`bash pi/test-subagent-completion.sh screen-only` is a negative control and must
exit nonzero at the missing-notification assertion. It modifies only a private
copy. `controls` and `cleanup` select smaller cases.

The printed evidence directory retains `result.log`, `notifications.json`,
`provider-requests.json`, receipts and launch files. Teardown verifies the private
tmux server and recorded child PIDs are gone. Some best-effort shutdown calls can
print missing-pane/server diagnostics.

These are macOS tests with actual installed child CLIs and scripted provider
responses, not real model inference or a native parent model turn. Arena shares
the launch/watch implementation but is not separately exercised here. Linux and
GUI behavior remain unverified.

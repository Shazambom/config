# Subagent pane capacity

The fix lives in the `tmux.ts` addition to
`pi/patches/interactive-subagents.patch`. Setup applies it to pinned upstream
source. Do not hand-edit the generated `pi/upstream/` package.

Burst creation repeatedly halved the parent pane before the debounced layout
callback ran. A private 180-column tmux window reproduced six successful splits
followed by no-space failures, despite having room for nine balanced splits.
Creation now balances synchronously. Closing panes retains its debounce and
layout failures remain best-effort. This reproduces a mechanism matching the
complaint, not a reconstruction of every historical launch failure.

True capacity exhaustion throws JSON text with `TMUX_PANE_CAPACITY`,
`launched=false`, `queued=false`, and `retryable=true`. There is no queue or
scheduled retry. Wait for running agents' completion notifications before
retrying; with no running agents, ask the user to free space or enlarge the
window. Do not substitute a different execution mode or poll for capacity.

## API and test lessons

- Match the complete known tmux stderr diagnostic. Substring matching also
  classified an invalid target named `no space for a new pane` as capacity.
- Set explicit piped stderr for the split command. Node's `execFileSync` otherwise
  prints child stderr before a catch can return the structured response.
- In installed Pi 1.0.4, returning `isError` from a tool executor did not propagate
  that flag through the tool loop. Throwing an Error with JSON text preserves the
  native error flag and structured content in the next provider context. No
  `tool_result` hook is needed. UI-only details are not the model contract.
- Discover the active CLI through `pi/command-path.sh`, then find its package
  ancestry. `npm root -g` can point at the portable Node runtime's empty global
  directory rather than the installed CLI. The parent run caught this before
  tests started; the discovery regression makes npm deliberately unusable.

Run `bash pi/test-subagent-capacity.sh` for fresh checksum-pinned source plus the
patch, or supply `all <package-root>` to test an already-applied package. It checks
nine live rapid splits, real exhaustion, fresh/resume failures without task or
registry mutation, SDK error propagation, explicit retry dispatch, unrelated
errors, and private-server/actor cleanup. A debounced mutant must fail the same
burst assertion. `bash pi/test-subagent-provider.sh` and `bash pi/test-team.sh`
cover related behavior.

The SDK uses synthetic in-process provider responses. Successful retries dispatch
exact tasks to private no-model actors, not full child inference sessions. Tests
exercise macOS tmux and installed SDK 1.0.4; Linux, GUI rendering, and live-model
recovery choices remain unverified. Existing sessions require reload or restart
to load the patch; deployment must not restart unrelated sessions.

The subsequent live nine-agent check exposed a separate completion problem:
two finished children left idle panes because terminal markers were unavailable.
See [subagent completion](pi-subagent-completion.md) for the durable-receipt fix
and full child-CLI tests. Successful launches alone do not prove result delivery
or pane cleanup.

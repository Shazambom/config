# Pi Command shortcuts in iTerm2

Read before changing fullscreen selection, macOS shortcuts, or the iTerm2 launcher.
See [Pi usage](../../pi/README.md) and [iTerm2 key settings](https://iterm2.com/documentation-preferences-profiles-keys.html).

## A binding is not proof that the key arrives

Changing the selection extension from `ctrl+c` to `super+c` deployed successfully
but did not fix the user's macro. Pi's fullscreen selection is application-owned,
not iTerm2's native selection. A correct handler cannot act on an event that never
reaches it. The first change was deployed without testing the complete route.

Pi calls the Command modifier `super`. Do not assume that means iTerm2 sends it.
In the private iTerm2 3.7.3 test, direct mode negotiated Kitty flags 7 while native
`tmux -CC` fell back to modifyOtherKeys. This observation alone did not establish
which shortcuts would arrive.

Session-local iTerm2 hex-send mappings were then tested inside `tmux -CC`. The
user's actual Cmd+C/V/Z presses arrived as CSI `99;9u`, `118;9u`, and `122;9u`.
Raw API injection was recorded separately and was not counted as physical-key proof.
Production tmux was not disabled or replaced to obtain this result.

## Test routing and application behavior separately

The received events exposed a second gap: Pi lacked the Command paste and undo
aliases. Actual installed CLI tests failed without the aliases and passed with
them, including the Vim editor. Cmd+Z must invoke undo, not Ctrl+Z suspension.

`pi/test-selection-copy.sh` exercises the application path. Its clipboard preload
in `pi/tests/command-clipboard.mjs` blocks native addons, subprocess helpers, OSC52,
and network access. Stubbing only `@mariozechner/clipboard` is insufficient for
Pi 1.0.4: its macOS backend also uses `darwin-platform.node` and `getFilePaths`.
Never use a person's real clipboard as unattended test scratch space.

The automated test covers text paste and undo, not actual system-clipboard image
paste. A live terminal routing result also does not prove an OS clipboard write.
Keep those evidence boundaries explicit.

## The root-pane-only fix did not meet the requirement

The first implementation used the launcher's exact native-tab identification and
session-only profile overrides. That avoided changing shared profiles and the
buried source shell, but made shortcut availability depend on how a pane was
created. Restarting old panes was not an acceptable lasting workaround.

Private native-tmux tests, including a parent rerun, confirmed that detach/reattach
creates a new iTerm session without the overrides. Split children and new windows
also lacked them; the original pane retained them across split and resize. A live
read-only snapshot found mixed mapped/unmapped panes in the same native window.
Do not call these physical-key or clipboard tests: they inspect actual profile state.

The guiding requirement is now highlight → Cmd+C → Cmd+V throughout Pi, including
existing/resumed/child panes and overlays, without auto-copy or paste submission.
`pi/test-copy-paste-universal.sh` is the acceptance-test entry point. A blocked
physical-key/clipboard run is not a pass. The old independent copy and constant
paste fixtures do not prove that pasted bytes came from the preceding copy.

The first live acceptance run reached a real RED: an overlay selection was active,
Pi received Cmd+C, and the clipboard retained its uncopied marker. The extension's
`hasOverlay()` guard rejects that path. No paste or later matrix cases passed.
Keep this failure distinct from the independently proven pane-mapping loss.

Fixture pitfalls: `detach-client -a` leaves a client attached; detach the explicit
private session and assert zero clients before reattaching. Custom messages alone
did not persist the fixture history; seed through the installed SessionManager and
verify both file identity and saved history on resume. Live tests also interrupted
the user's focus and produced dialogs. Subsequent screenshots identified the
warning as **a session ending very soon after starting**, not API authorization.
Keep the private control shell alive after tmux detaches, then close it explicitly;
do not suppress the warning globally. Keep one stable harness, avoid unconditional
focus restoration, and report GUI blockers separately from product REDs.

A root pane is launched with Pi as its command; when that pane ends, its local
mappings end too. Subagent commands return to a shell and do not share that lifetime.
Private checks established that the local mappings were not inherited by newly
created native sessions. Any replacement must handle these lifetimes explicitly,
without assuming that a Pi process and its terminal pane have the same lifetime.

## Mode-aware conversation navigation

`pi/agent/extensions/vim-scroll.ts` maps standalone uppercase G to conversation
bottom in fullscreen Vim normal mode. Use the focused editor's `getVimMode()` and
`isVimInputPending()` instead of tracking Escape/insert transitions separately.
Pending operators/counts, insert input, and overlays must retain their own keys.
`bash pi/test-vim-scroll.sh` tests the actual installed CLI in a private tmux server,
including legacy and extended Shift+G. Assert that pending commands remain
editor-owned; do not assume unrelated Vim editing semantics from a key's name.

## Native selection rollout: verification limits

Native selection disables click/drag reporting but retains wheel reporting, removes
Command C/V forwarding, and uses iTerm's native Copy/Paste handlers. Persisting this
in the built-in `tmux` profile also affects non-Pi applications in integrated panes.
The user explicitly accepted that tradeoff, including Neovim mouse actions.
`init.sh --pi` now invokes the existing API helper to configure saved defaults and
current integrated panes; non-tmux profiles and external preference folders are
left alone. An absent/ambiguous saved `tmux` profile fails visibly rather than
claiming configuration succeeded.

Deployment ran through `init.sh --pi`. Parent readback verified the saved profile
and six existing integrated sessions: click/drag reporting off, wheel reporting
on, and no Command C/V overrides. Global CopySelection was off and the dedicated
tmux-profile preference was on. Twenty-seven Python unit checks plus preference
and init-target shell checks passed. This readback is configuration evidence, not
a new full clipboard or physical-wheel acceptance run.

Native-menu testing reached 14 of 20 cases before the strict focus guard stopped
on a different front window. This is not a full acceptance pass or physical-key,
physical-drag, or physical-wheel proof. Source review also caught a one-item tuple
construction error in the launcher fixture; use a direct expected-map dictionary.

Harness corrections: activate the application as well as the owned session before
menu actions, and read back actual native selection before blaming disabled Copy
on a modal. Ordinary contiguous selection includes visible gutters on subsequent
rows; derive the expected highlighted bytes independently from verified rendered
fixture rows, then require Paste to reproduce those exact bytes. Do not substitute
the clipboard output as its own oracle or require a different selection gesture.
iTerm profile booleans can return as numeric 0/1; compare values, not Python object
identity. Preserve focus-change refusal rather than stealing focus back.

## Simplification and existing terminal mechanisms

The four-angle simplify pass found no useful shared helper to extract. It removed
duplicate acceptance-case enumeration and changed acknowledgement lookup to decode
records backward only until matched. The synthetic latest-match check dropped from
1,001 JSON decodes to one. `test_journey.py` and `test_safe.py` run offline; these
checks do not establish clipboard correctness. All 20 case identities and their
order were preserved. Moving mapping code into another helper was deliberately
skipped: rearranging the one-shot policy would not repair its lifetime mismatch.

[iTerm2 key settings](https://iterm2.com/documentation-preferences-profiles-keys.html)
document built-in **Copy or send ^C** and **Paste or send ^V** actions. They may
provide a simpler native-selection/application-selection bridge than per-pane
Super-key overrides. Copy falls back to literal Ctrl+C without native selection;
paste uses native text paste, falling back to Ctrl+V without clipboard text. These
are candidates, not verified fixes. A Cmd+C with no selection could consequently
cancel/clear an application; do not silently introduce that behavior.

[Terminal settings](https://iterm2.com/documentation-preferences-profiles-terminal.html)
also separate mouse click/drag reporting from wheel reporting. Native selection
could retain wheel scrolling but would sacrifice application mouse-click behavior
in the affected profile. Treat that as a consequential tradeoff, not a free fix.
[Native tmux documentation](https://iterm2.com/documentation-tmux-integration.html)
describes an iTerm2 3.7 background-window setting that may avoid focus theft; its
interaction with deliberate root-tab launch still needs validation. Claude Code's
fullscreen documentation is comparative evidence only, not a Pi compatibility claim.

`iterm2/test_reorder.py` checks targeting and refusal cases.
`iterm2/test_live.py` checks the actual launcher in an isolated native window.
Retain Ctrl shortcuts as fallbacks, keep selection auto-copy controlled by its
existing setting, and verify that dragging alone does not write the clipboard.

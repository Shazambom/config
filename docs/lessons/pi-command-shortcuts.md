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

## Keep terminal changes scoped

Use the existing launcher's exact native-tab identification and session-only
profile overrides. Merge the three keys without changing shared profiles, the
buried source shell, or unrelated bindings. Do not add a watcher or global remap
merely to handle existing panes. Existing panes can be restarted.

A root pane is launched with Pi as its command; when that pane ends, its local
mappings end too. Subagent commands return to a shell and do not share that lifetime.
The private split-pane check did not establish mapping inheritance. Do not silently
extend the root-pane solution to child shells or claim existing-tmux launches are
covered. Those paths require a separate decision about scope and restoration.

`iterm2/test_reorder.py` checks targeting and refusal cases.
`iterm2/test_live.py` checks the actual launcher in an isolated native window.
Retain Ctrl shortcuts as fallbacks, keep selection auto-copy controlled by its
existing setting, and verify that dragging alone does not write the clipboard.

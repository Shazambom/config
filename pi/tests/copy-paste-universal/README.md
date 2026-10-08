# Copy/paste acceptance journey

Safe default, exit 77 with no GUI, tmux, or clipboard access:

```sh
bash pi/test-copy-paste-universal.sh
```

Clipboard-free live bootstrap:

```sh
bash pi/test-copy-paste-universal.sh --bootstrap
```

Physical-key acceptance run:

```sh
bash pi/test-copy-paste-universal.sh --live-manual --replace-clipboard
```

Automated native menu-handler run, using inherited profiles:

```sh
bash pi/test-copy-paste-universal.sh --native-menu --replace-clipboard
```

Add `--candidate-profile` to apply mouse-reporting candidate properties only to
owned test sessions. This is not deployment proof. Native mode creates contiguous
CHARACTER selections through the iTerm API and invokes Edit Copy/Paste, not raw
CSI, simulated Cmd keys, rectangular selections, or physical mouse drags. It
requires an uninterrupted focus interval and aborts if focus moves elsewhere.
Wheel reporting flags are checked; physical wheel behavior is unverified.

The two flags authorize clipboard replacement; there is no additional confirmation
prompt or controlling-terminal requirement. Save anything important yourself first.
The test never reads, saves, or restores the previous clipboard. The first clipboard
operation writes a synthetic marker. Stop clipboard managers and do not copy other
text during the test. This test assumes exclusive clipboard use; another process
can race any OS clipboard read. Unknown clipboard contents are never logged.
Whitelisted synthetic fixture text and independently verified rendered whitespace
may appear in diagnostic artifacts.

## Follow the widget

One owned iTerm2 window opens. Follow instructions in the Pi widget or focused
overlay. Click to clear an old selection, highlight the displayed synthetic fixture,
wait for the Cmd+C instruction, then physically press Cmd+C. When prompted, physically
press Cmd+V. Do not press Enter. Progress and assertions are automatic, with a
90-second timeout per manual action. No return to the controller is required for
individual copy/paste cycles. Switch to the next owned pane/tab when the current
widget says the context is complete; the controller prints its tmux pane ID.

Selection may be Pi-owned or native iTerm selection. The test observes Pi state
and native selection bounds. Native mode also reads back the owned fixture's
selection to validate its geometry before calling Copy. The final copy oracle is
exact clipboard bytes, independent of key mapping implementation. The test never
injects Cmd sequences or mouse drags. Physical key delivery is operator-supplied,
not proof of an OS automation permission.

## Bounded acceptance matrix

Twenty cases cover five actual transitions, with four cases per transition:

- New root launched through the real `pi.sh` and native `tmux -CC` path.
- `pi.sh` invoked inside an already-running private shell pane.
- That pane respawned into the same saved session, checking file identity and
  preserved synthetic history, not just its UUID.
- The private tmux client detached and natively reattached without rerunning the
  root mapping helper.
- A newly split pane running Pi through `pi.sh` inside tmux.

Each transition tests a fresh focused overlay selection pasted into its real
`@earendil-works/pi-tui` Input, transcript text pasted into the main Vim editor,
and two main-editor cycles with distinct multiline values. The second main-editor
cycle includes a trailing newline. The single-line Input case uses single-line
text; it does not demand multiline behavior from that component.

Native selection copies visible rendered text. A contiguous multiline selection
includes the gutter before its second and later lines. The oracle is independently
derived from known fixture text plus verified visible gutter columns, never copied
from the clipboard or selection readback. Native Copy trims right-padding but keeps
the visible left gutter and selected trailing blank line. Unknown prefixes or
changed fixture characters fail the test. Paste must match these exact copied bytes.

Every case checks no copy on selection, exact copied bytes, unchanged draft on copy,
exact focused value on paste, and zero submissions in both main and overlay inputs.
Overlay paste must not leak into the main editor. The overlay forwards input directly
to the installed Input component; it has no custom copy/paste implementation.
Received Cmd counters are diagnostic observations, never synthetic-key proof.

PASS requires this complete representative matrix. This is not a claim about every
third-party extension. A failed assertion is FAIL. Missing prerequisites or a manual
action timeout are BLOCKED. The run stops at the first failure and leaves remaining
cases NOT_RUN in its synthetic-only results artifact.

## Isolation and proof

The real installed CLI runs with a private HOME and agent directory, no credentials,
no tools, Node network denied, and the repository's selection extension, bindings,
and pinned Vim package. Launcher setup is stubbed to avoid installation/deployment;
tmux is redirected to a private socket. Saved-session fixtures use the installed
SessionManager API and synthetic assistant history without invoking a model.

Cleanup kills only the private server and closes the owned window. It never calls
activate/restore-focus during cleanup, since that can steal focus from someone typing elsewhere.
Native mode explicitly activates only its owned target at the start of each case;
it does not refocus after a mid-action focus change. Control shells stay alive after
native tmux detach so short-lived-session warning dialogs do not interrupt the test.
The clipboard remains synthetic after an opted-in full run. Artifacts and owned IDs
are printed. No existing user tmux server is changed.

Bootstrap was exercised against the installed CLI and iTerm2: root, existing-pane,
resume, detach/reattach, split, and real Input overlay states were reachable. Both
owned test windows were confirmed absent afterward and the private servers stopped.
Bootstrap does not read/write the clipboard or test physical keys. The full physical
copy/paste matrix has not yet run. Offline safety checks are in `test_safe.py`.

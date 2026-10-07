# Private conversation lab

Use the control command supplied by your operator. Run `help` to see its arguments. Commands work from the supplied private working directory.

A lab has an opaque ID. A conversation is saved chat; an instance is a running view of that chat. A client is a private terminal connection. Choose simple names such as `chat`, `first`, and `second`.

```text
create
attach ID first
open ID chat
screen ID chat
type ID chat "Hello from a synthetic conversation"
key ID chat Enter
saved ID chat
status ID
```

`type` does not submit. `key ... Enter` submits. The local provider echoes ordinary chat. Startup and replies may take a moment; use `screen`, `saved`, or `status` to observe them.

For a longer reply, type `slow your plain text` and submit. The reply acknowledges with `LAB_STARTED`, emits visible `LAB_CHUNK` lines for 15 seconds, and finishes with `LAB_DONE`. Press Escape to cancel. `status` includes stream receipts and whether a stream completed or its connection ended early. This input never runs tools or shell commands.

For an independent opening of saved chat, use `fresh ID chat other`. Use `other` for screen, type, key and saved operations on that instance. `reconnect ID chat` returns to an existing live instance without starting another. `open ID chat` allocates an instance named `chat` and rejects an already-used instance name. To resume saved chat after quitting, use `fresh` with a new instance name.

Successful `open` or `fresh` means the launch was observed, not that the app accepted ownership or work. The app may display a prompt, refuse opening, or exit. Inspect `screen` and `status`. A failed opener leaves other running instances intact. Each instance has a private working directory but opens the saved conversation you named.

Attach more clients with distinct names. Use `switch ID CLIENT away` or `switch ID CLIENT INSTANCE` to change windows without disconnecting. Use `resize ID CLIENT COLS ROWS`, `detach ID CLIENT`, or `close ID CLIENT` to change a client. To connect again, attach a new client name.

Safe app commands include `/help`, `/hotkeys`, `/session`, `/resume`, `/new`, `/reload`, `/quit`, and `/exit`. Type a command, then press Enter. Supported keys are Enter, Escape, C-c, C-d, Up, Down, and Tab. `saved` lists raw user/assistant entries in the originally assigned conversation; it does not identify the active conversation branch the app restored. After an in-app session switch, use the visible UI to inspect that session.

The controls reject control bytes, `!`, `@`, and other slash commands. They do not expose shell commands, external editors, login, browser actions, clipboard, selection, paste, GUI terminals, or arbitrary key sequences. Use only synthetic chat and the control command. Environment isolation is not an OS sandbox; run only trusted candidate executables.

`create --cli EXECUTABLE_OR_PACKAGE` selects another installed candidate. An operator can also select trusted extensions with repeatable `--extension PATH` arguments. No installation is performed; use only the build selection authorized by your operator.

Finish with `cleanup ID`. It stops owned resources and retains evidence. A cleanup error requires operator attention. Do not delete evidence or signal processes manually.

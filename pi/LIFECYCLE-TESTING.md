# Lifecycle debugging lab: test design

This is the test contract, not a claim that lifecycle protection is implemented.
Each run must identify which cases passed, failed, were blocked, or were not run.
Fixture cleanup must never count as the application satisfying a lifecycle rule.

## Approved implementation boundary

Use an extension and an external supervisor, not patches to Pi's native CLI or SDK.
Brief startup overlap and native startup metadata writes are acceptable; the guard
must resolve ownership before admitting continued agent/tool work. Tests distinguish
startup metadata from conversation changes rather than demanding byte-identical files.

An attached conflict offers **Continue here**, **Go to existing session**, and
**Cancel**. Continuing requires verified shutdown of the prior root runtime,
then a fresh history reload before new work. Its workers may take up to five
seconds after root exit to stop; already-started actions may finish in that window.
The replacement need not wait for every worker. Jumping exits
the new runtime only after navigation succeeds; failure keeps the choice available.
A verified orphan is taken over automatically. Ambiguous identity never authorizes
killing a process. A known conflict must not be disguised as an initialization error.

Guard initialization errors do not brick Pi: show a persistent, prominent unprotected
warning, write private credential-safe diagnostics including a stack trace, and
inject one investigation prompt per failure without repeating it on redraw/reload.
Test this failure behavior separately from healthy ownership enforcement. There is
no exact-version allowlist; unsupported required APIs take this visible failure path.
An extension that is disabled or cannot itself be loaded cannot provide protection.

The user manages restarts. Deployment must not restart or terminate existing
runtimes. Legacy/unmanaged processes and SDK paths bypassing the extension are not
silently counted as protected; report those coverage limits explicitly.

## Two independent testing tracks

**Developer regression tests** exercise process, terminal, ownership and persistence
boundaries. A failing behavioral assertion comes before its production fix. The
same assertion must pass afterward without changing the expected behavior.

**Black-box user QA** gets a fresh conversation, an isolated working directory,
operator controls and user expectations. It does not receive source, patches,
implementation plans, previous findings or expected failures. It can improvise
actions, inspect the visible application, and report reproducible user-facing
failures. Later comparisons use anonymous build labels; the developer retains the
mapping to exact runtime manifests.

This is procedural blinding, not an OS security boundary. The QA agent must use
the lab controls rather than launch or inspect arbitrary host processes.

## Isolated runtime and controls

- Discover the actual installed CLI through `pi/command-path.sh`; resolve package
  inputs through `package.json`'s `bin.pi`. Do not substitute an unbundled entry
  point or the repository SDK. SDK tests are a separate, explicitly labeled track.
- Support an explicit candidate CLI without modifying the installed package.
  Record the selected entry point, package version and relevant content hashes.
- Create private HOME, agent directory, working directory, sessions and tmux
  socket. Generate fresh synthetic history and identities, never copy real user
  sessions. Do not run setup against the user's environment as part of a test.
- Use a deterministic loopback model for real request/response, streaming and
  controlled tool work. Do not load real credentials. Restrict fixture tool work
  to predetermined, lab-owned operations.
- Use real terminal clients attached through private PTYs. Attach to an owned
  placeholder before starting terminal-bound Pi. A detached tmux server alone
  is not proof of an attached terminal.
- Provide user-facing operations for opening/resuming conversations, viewing the
  screen, typing, safe keys, resizing, connecting/disconnecting terminals and
  inspecting saved results. Operations address inventoried lab resources only.
- Restrict text and keys so tests cannot accidentally invoke host shell escapes,
  external editors, authentication/browser flows or clipboard operations. A PATH
  shim is not adequate clipboard isolation. Mouse selection/copy/paste remains
  excluded until its actual backend can be safely isolated.
- Do not activate, restore focus to, resize or close the user's terminal windows.
  Native iTerm control-mode testing needs a separately authorized, disposable GUI
  adapter and its own evidence; private tmux does not prove native GUI behavior.

Sanitized environment variables and a Node TCP guard are useful defenses, not a
universal filesystem or network sandbox. Explicit limitations belong in reports.

## Observation and cleanup

Capture user actions and acknowledgements, Pi input/output, fake-provider request
and completion events, saved-session state and actual process liveness. Correlate
observations on a shared clock where possible. Distinguish request acceptance,
operation start and operation completion: already accepted external effects cannot
be undone merely by terminating their caller.

Track each owned process with a unique run identity, PID, start identity and
lab-specific launch identity. Verify identities before signals or escalation.
Do not use global name-based process killing or target the user's tmux server.
Cleanup must be bounded, verify exit, preserve unrelated sentinel processes and
report ambiguous identities rather than guess. State platform PID-race limits.

Observe a failed product invariant **before** emergency cleanup. Record both the
failure and the later cleanup outcome. Preserve artifacts on success and failure,
including launch manifests, input sequences, screen/ANSI captures, assertion
results and cleanup receipts. Missing observations are infrastructure failures,
not automatic product passes or failures.

## Lifecycle and persistence matrix

| Case | Required observation |
| --- | --- |
| Final relevant client disconnects | Terminal-bound Pi and workers terminate; saved history remains readable. |
| One of multiple relevant clients disconnects | The remaining connection keeps the instance usable. |
| Tab/window/pane selection changes | Work and draft remain; selection is not ownership loss. |
| Unrelated client remains on the same server | It does not keep an inaccessible Pi instance alive. |
| Plain terminal PTY disappears | Its runtime terminates without requiring cooperative UI shutdown. |
| Root exits, crashes or is killed | Its terminal-bound workers stop within five seconds; independently launched services survive. |
| Runtime is busy, hung or ignores TERM | External enforcement remains effective; escalation is bounded and identity-checked. |
| Reopen after abandonment | Old work stops and exit is confirmed, then history is freshly reloaded before replacement work begins; an earlier startup read is permitted. |
| Reopen while another owner is attached | Clear ownership choice or access to the existing terminal; no silent destructive takeover. |
| Concurrent guarded opens or child resumes | Startup checks resolve to one continuing writer, except explicitly reported unprotected failure mode. |
| Path aliases | Equivalent references cannot bypass ownership. |
| Delayed old shutdown/retirement/cleanup | Replacement runtime, membership and unrelated pane work remain intact. |
| Reload and navigation within a session | Ownership survives where the saved-session manager remains active. |
| Session transitions | Recheck ownership before continued work on supported transitions; document operations beyond extension control instead of claiming native write fencing. |
| Team on and off | Session ownership does not depend on team collaboration being enabled. |
| Memory jobs | May be cancelled with their owning runtime and lose unfinished results. No survival, adoption, result recovery, or new job deadline is required. |
| Noninteractive CLI and SDK usage | Explicitly integrated workers obey their lifetime contract; unintegrated SDK/extension-disabled paths are reported as outside protection. |
| Guard initialization failure | Pi stays usable with persistent warning, safe diagnostic file/stack and one investigation prompt; no silent unprotected operation. |
| Failure during setup or tests | Cleanup does not kill unrelated work or leave unreported owned processes. |

Linked/moved tmux windows and native control-mode clients need explicit relevance
checks. Counting every client on a tmux server is insufficient.

Use a bounded observation deadline and report actual stopping time. A deadline is
not a grace period authorizing additional work. Do not claim instantaneous physical
disconnect detection or rollback of already accepted remote operations.

## UX regression matrix

Exercise typing during streaming and resizing, draft preservation, transcript
reading position, wheel/keyboard scrolling, interruption, exit, and reopening.
Use both short and realistically large **distinct** synthetic histories. Test the
actual deployed UI packages separately from bare-core controls. Record latency
ranges and instrumentation overhead, not only a single best run.

Drafts must survive in-session navigation, resizing and interruptions. Draft
persistence after explicit exit or a crash is not a promised requirement.
Keep the existing worker cancellation on `/reload` and same-session resume;
worker survival across those operations is not part of this feature.
Independently launched application services are not owned Pi workers and must
not be killed by lifecycle cleanup.

Clipboard testing and native GUI behavior are not covered by ordinary PTY tests.
Do not report them as passing without a safe, relevant test path.

## TDD and validation sequence

1. Prove the fixture can start a real client/runtime, exchange a synthetic model
   response, observe state, reject foreign targets and clean up on failure.
2. Establish a meaningful lifecycle RED on the unchanged runtime. Start with final
   client disconnect, alongside surviving-client and navigation controls.
3. Implement the smallest extension/supervisor change for that invariant using
   the approved overlap, conflict-choice, fail-open and user-managed restart rules.
4. Rerun the unchanged regression, controls and relevant persistence/UX cases.
5. Refactor only with tests green. Expand one boundary at a time rather than
   declaring the entire matrix covered by one detach test.
6. Give independent QA the same public controls and expectations on anonymous
   builds. Turn reproducible failures into developer regressions without coaching
   QA toward an implementation-specific result.
7. Independently inspect and rerun delegated evidence. Resolve test-observation
   failures before blaming Pi. Report untested cases and residual risks.
8. Deploy only through `init.sh` after review; do not restart or terminate existing
   runtimes as part of deployment. Verify installed resources and a new isolated
   runtime. A private candidate pass is not proof that the user's running process
   has loaded the extension.

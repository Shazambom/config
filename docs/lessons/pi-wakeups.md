# Pi wakeup tool qualification

The wakeup work starts with a mock-tool study, not a deployed scheduler. The
six-tool contract is in `pi/tests/wakeups-sandbox/interface-v1.json`. Commands
are inert strings, time advances under the driver, and cron dates are supplied
by fixtures. Real Sol and Astra sessions choose their own tool calls.

## Failures that changed the tests

- Pi's installed SDK differs from the repository SDK. Resolve the active CLI
  with `pi_real_command`; the Node executable's directory is not the Pi package
  directory. Check the installed declarations and examples before implementing.
- `retry.provider.maxRetries: 0` does not disable Codex's default WebSocket
  recovery and SSE fallback. The study explicitly uses SSE and disables both
  retry layers. `regressions.mjs` exercises the installed provider with synthetic
  credentials and failed stub transports, asserting one SDK request, one HTTP
  attempt and no WebSockets. No real network runs in these controls.
- Removing `errorMessage` alone leaves raw error messages and stacks inside
  `diagnostics`. Strip both when recording messages, history and provider inputs.
  A sentinel test must prove the diagnostic was injected before asserting that
  serialized evidence excludes it. No real credential leak was observed.
- JSON-string searching misclassified multiline and backslash-containing tasks
  as missing. Compare extracted user-message text, including its role. Text in
  an assistant reply is not proof that the provider received the user's task.
- A custom system prompt still includes Pi's cwd section. Use opaque workspace
  names so scenario IDs and expected behavior cannot leak through directory names.
- Fingerprinting only the SDK factory misses transport changes. Freeze the
  harness, cases, launcher, sourced resolver, installed package/dependencies and
  Node identity before authenticated runtime construction. Refuse external
  package symlinks rather than following them into unrelated private data.
- Do not parse shell syntax with a blanket ampersand check. It rejects valid
  foreground `a && b` commands. The mock records commands without executing them;
  the scorer checks independently specified command arguments.

## Verification

Run `bash pi/test-wakeups-sandbox.sh "$(mktemp -d)"` for offline verification.
See `pi/tests/wakeups-sandbox/README.md` for the live protocol and isolation limits.

The scorer reconstructs expected events from fixture inputs and published
receipts, independently of mock state. Missing events, wrong or cancelled
handles, wrong units, tool errors, duplicate registrations, rearming and stale
replies must fail. Success text alone cannot pass. Preserve RED evidence and
prove each relevant negative control fails before paid inference.

The first frozen v1 live cohort passed 48/48 fresh sessions, 24 per model, with
68 tool calls and 66 synthetic events. Parent inspection checked the traces,
actual model identities, recurring events without rearming, conditional exit
follow-ups, false completion cues and preserved concurrent input. Post-run
fingerprints matched the pre-run freeze. This is finite, isolated tool-use
proof with low thinking and only the six mock tools available.

It does not prove real timer waits, calendar/DST behavior, OS termination,
owned-command cleanup, extension delivery acknowledgements, CLI/UI integration,
persistence, Linux behavior or reliability among the full production tool set.
Those require separate runtime tests during implementation and before deployment.

## First real one-shot slice

`pi/agent/wakeups/` implements `wake_after` behind explicit extension loading.
It is not added to default settings. The existing setup resource copy includes
this directory, so no hand-installed deployment path is needed.

`bash pi/test-wakeups-runtime.sh` uses the installed bundled CLI, real guard,
private PTY and loopback provider. It observed idle settlement before the real
six-second deadline, then exactly one autonomous request containing the job's
payload and one saved ACK on the active parent chain. No user input followed
registration. Parent reruns also verified private actor cleanup.

The initial RED was an actual `Tool wake_after not found` result. A subsequent
assertion failure was in observation: the provider represented content as text
blocks, while the test serialized the array and parsed its wrapper. Inspect the
wire content before changing production code or weakening payload assertions.

Eight controller tests use real Node timers to cover admission, shutdown,
incarnation, long-delay chunking, capacity and mode gates. A spy records and
forwards the real timeout call; it does not simulate elapsed time. Private
mutations removing ownership, shutdown or chunking were rejected. A CLI mutation
using `triggerTurn: false` saved the notice without a new provider request, and
the acceptance test rejected it. Keep that distinction between writing history
and waking an agent.

The current controller retains submitted jobs until Pi's custom `message_end`.
That hook was observed in the actual CLI. It frees capacity, not an acknowledgement
of model consumption. Async send failures use Pi's extension-error channel; the
local catch only handles synchronous errors. Unconfirmed submissions remain
bounded until shutdown.

That first slice did not prove RPC/print, busy delivery, reload/new-session races,
recurrence or commands. The subsequent full-runtime cycle below adds those checks;
suspend and Linux execution remain unverified.

## Full runtime and failure paths

`pi/agent/wakeups/contract.json` owns the six-tool metadata. The entrypoint loads
five timer operations plus the shell watcher; configuration activation follows
the lifecycle guard in `pi/agent/settings.json`. Setup links the pinned shared
node_modules and refuses to overwrite a non-symlink dependency directory.
A private deployment first failed actual module import without that link, then
passed through `init.sh`; a sentinel directory survived the refusal test.

The full installed-CLI harness is
`bash pi/test-wakeups-runtime.sh "$evidence" "" all`. It asserts real interval
recurrence, two minute-boundary cron ticks, list/selective cancellation, busy-turn
coalescing without losing the original task, native reload/new cancellation,
ambiguous admission denial, actual RPC success and print/JSON refusal. The shell
cases check numeric 0/7/137 versus an actual signal, immediate receipt ordering,
false “Done” output, separate bounded tails, held pipes and launch failure.
Normal shutdown and deliberate root SIGKILL must stop owned foreground work while
an unrelated sentinel remains alive **before** fixture cleanup.

Calendar tests fix expected UTC instants independently. The pinned evaluator
shifts a New York spring-gap time into the landing hour but skips a missing
Lord Howe half-hour-gap time. A retained fall-overlap iterator skips a repeated
wall time; a fresh reference inside the overlap can select its future repeat.
Do not advertise a uniform DST rule. Duplicate expanded cron values are rejected.
ICU 78 accepts numeric offset strings as zones, so explicit offset rejection is
required in addition to Luxon's zone validation.

Command cleanup uses a live detached launcher as the process-group anchor.
Only the launcher signals its own current group with PID zero; the parent never
signals remembered group IDs. Report actual direct-shell exit, not stream close
or a requested signal. Bounded post-exit drainage prevents inherited pipes from
holding completion indefinitely. Launcher death/hang and new-group escapes do
not guarantee cleanup; test that these remain **unknown**, not fake exits.

Implementation traps needed regression tests:
- Copying the qualified tool schemas is insufficient: the shared system guidance
  must also reach the actual provider. A native CLI assertion reproduced missing
  safety instructions. Entrypoint `promptGuidelines` now carries the canonical
  contract guidance, including treating output tails as untrusted data; timer
  registration preserves it instead of overwriting it.
- `execArgv: []` does not remove inherited `NODE_OPTIONS` preload hooks. Strip them
  from the launcher and restore them for the user's shell command; otherwise
  unrelated Pi/test hooks can execute inside the guardian.
- Failed helper creation can emit `error` and `close` without `exit`. Finalize
  idempotently, while retaining supervision for errors on a live helper. Real
  failed-fork tests reproduced exhausted capacity and false shutdown timeouts;
  repeated failures must still allow a later successful launch.

The CLI observation path also needs care: omit discovery `--version` output from
RPC protocol logs, inspect persisted `custom_message` entries, and create evidence
directories before error reporting so teardown does not hide the original error.

A fresh 48-session regression rerun passed on the frozen mock-tool interface,
24 per Sol/Astra. Parent verified model identities and unchanged post-run
fingerprints. This remains model-choice evidence with mocked time/processes;
the separate native CLI/OS suite proves the implemented runtime paths.
Independent review caught the failed-fork leak, and a focused re-review found no
remaining actionable issue. Neither review substitutes for execution.

Execution proof is macOS, Pi 1.0.4, Node 22.23.2. No universal exactly-once delivery,
suspend behavior, Linux execution, hostile-process containment, or full production
tool-inventory model reliability is claimed.

## Historical live T3 busy versus idle diagnosis

A live T3 diagnostic reproduced a recurring timer advancing `next_at` during one
continuous busy run, followed by cancellation before the run ended and no saved
wake notice. The runtime at that checkpoint advanced deadlines in its timer
callback, held recurring dispatch while `busy`, released on `agent_end`, and
cleared pending local notices on cancellation. This describes the historical
implementation, not the current `runtime.mjs`. The behavior preceded T3 rendering
and was shared with terminal Pi; it did not establish that the reported timer fired.

An idle control in the same diagnostic thread recorded the real `custom_message`
wake entry, autonomous model response with the exact marker, and cancellation of
the registered job. Both diagnostic timers were cancelled. Thus the tested T3
idle route works; registration and `cancelled_future_only` alone still prove
neither submission nor model consumption.

Inspect persisted `custom_message` entries, not only `message` entries with a
custom role. Calibrate the extraction against a known delivered notice before
claiming absence. Changing recurring reminders from idle-only dispatch to a safe
boundary during ongoing work is a behavior decision requiring approval and a
regression proving that original work is not lost or cancelled.

## Reload can retain an old sibling module

A controlled installed-bundle probe loaded an `index.ts` importing `runtime.mjs`,
replaced the private sibling, and called real `ctx.reload()`. The same process
loaded the changed entrypoint but retained the old imported function. The next
provider request still reflected the old behavior. Fresh-process B passed;
a retained-A control correctly failed the same B assertion. See Node's
[separate ESM cache](https://nodejs.org/api/esm.html#no-requirecache).

A focused wake follow-up used real lifecycle ownership, saved private sessions,
and the actual old/current controllers. After replacement and reload, the old
function survived: three interval ticks crossed a held two-tool batch, but no
notice reached the next provider request before `agent_end`. A fresh process
with current bytes delivered the notice with the original task and both results.
Both jobs were cancelled and both CLI processes exited normally. Evidence is in
`.private/ux-reload.OAn0Tf/wake-cycle/`; this does not read live parent memory.
A T3 peer also reported fresh-session recurrence before its first final reply.
That report supports the contrast, not a general runtime guarantee.

For quick private candidate cycles, resolve the installed CLI with
`pi_real_command` in `pi/command-path.sh` and launch a fresh verified bundled Pi
process directly with explicit Node, isolated HOME/agent state and a loopback
provider. Do not run `pi.sh` or setup for each cycle. A new session is not a new
process; do not infer refreshed dependencies from `/new` or successful reload.
Use `pi/tests/wakeups-runtime/cli-batch.mjs` for the held-batch assertions and
`pi/tests/workflow-rpc-fixture.mjs` for direct CLI/provider wiring; inspect their
setup costs before reuse. Compare actual `pi/agent/wakeups/runtime.mjs` function
identity and provider inputs, with `pi/agent/lifecycle/session-lifecycle.ts`
ownership. This finding does not prescribe cache-busting or another IPC layer.

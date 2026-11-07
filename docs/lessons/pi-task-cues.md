# Root task cues and observed recovery

Private candidate only. Settings activation and real identity integration belong
to the integration owner. Nothing here grants permission to publish or deploy.

## Preserve input, do not infer authority

The context handler appends one ephemeral advisory message to a new array. It
never filters original messages, including an existing `task-cue` custom message.
A user-role message does not establish a new goal. Root guidance uses ordinary
conversation notes and labels agent interpretation separately from agreement.

Root activation requires exactly one positive `subagents:identity` reply matching
the current context file and exactly one owned lifecycle reply matching its
canonical file and pinned generation. Missing, stale, child, ambiguous or throwing
responders suppress only observation recording and cues. They do not alter tools,
messages, helper use or result delivery.

## Evidence is not an outcome

Use `getBranch()` for the current branch. Read canonical JSONL with ordinary
read-only file access, not `loadEntriesFromFile`, which can repair newlines and
skip corruption. `appendEntry` can leave a live memory ghost after a failed write;
a successful append also does not prove a file was saved. Compare canonical entry
identity and contents before calling an observation saved.

The shared session/call/parent projection requires exactly one attempted event
and one matching-name reported result. Distinct entry IDs are distinct events,
even with identical payloads. Transcript calls cross-check coverage rather than
adding a second attempt for the same event. Nested execution observations have
different coverage from top-level transcript calls. Missing observations,
malformed schemas, repeated identities and truncated files remain unknown.

Tool start precedes validation. Tool end is a reported result. Neither is an OS
process start/exit receipt, proof of current artifact contents, or recovery of
invisible child work. The cue must not replay an uncertain operation or impose a
blanket approval gate. The agent can inspect evidence and continue normally.

## Label missing instrumentation without implying unfinished work

An old canonical call/result pair can lack task-cue observations. Keep that
coverage unknown, but label the absence as no task-cue result observations rather
than no recorded result. The counter is `explicit unresolved observation
identities`, not unfinished operations. Missing instrumentation does not mean
work is unfinished. Do not add transcript fallback or change projection counts
to repair wording. `pi/tests/task-cues/coverage-labels.test.mjs` covers complete
historical pairs, call-only history, repeated attempts and live-only provenance.

## Escape the complete bidi-control set

Independent review found that scalar escaping omitted U+061C, U+200E and U+200F.
An explicit Unicode Bidi_Control test set reproduced all three leaks through both
scalar formatting and rendered progress. Include these marks alongside embedding,
override and isolate controls. Test tool name and call ID independently of the
implementation regex, preserving ordinary Unicode, existing control escaping and
the cue's character bound. Regression: `pi/tests/task-cues/bidi.test.mjs`.

## Tests and observed fixture failures

`pi/tests/task-cues/runtime.mjs` runs the actual selected bundle with private
synthetic settings/auth and a loopback scripted provider. Its first RED failed
at the missing provider cue after the original write and tool pair succeeded.
The forwarding-drop control fails that same assertion. The recovery case kills
only its own CLI after an effect barrier, resumes with a new task, checks the
provider input and inspects the counter to rule out duplicated effects. An
unrelated owned sentinel must survive the interrupt and is cleaned up separately.

`pi/tests/task-cues/observations.test.mjs` covers pair counts, source provenance,
malformed JSON, escaping, identity suppression, image/object preservation and
append ghosts. Its initial identity fixture supplied a noncanonical temporary
path on macOS. The guard correctly suppressed cues. Canonicalizing the fixture
owner path fixed the observation method; the production comparison was retained.

The dedicated task-cue runtime fixture uses identity and lifecycle stubs; label
those receipts accordingly. Separate integration runs used the real identity
producer and lifecycle with the frozen bundle: standalone root images,
reload/new/fork and interrupted-root recovery; actual T3 root with team OFF,
bound-child cue suppression, normal helper completion and interrupted-root
recovery. Scripted providers prove the exercised input/output path, not semantic
adherence by arbitrary models. Standalone spawned-child proof is an accepted unverified gap: the user stopped
the PTY/sandbox test effort. Native CLI image input is also not covered.

Never invoke a repository launcher to identify or version a test binary. Private
HOME alone does not isolate setup writes to shared dependencies. Resolve and
freeze the actual bundle/runtime assets, use a whitelisted environment, and deny
unrelated writes/non-loopback traffic before launch. Keep invalid fixture images
and incomplete package copies separate from product failures. The actual native
leaf fixture must allow the existing implicit ask_question tool; do not alter
production tool permissions to satisfy a stale fixture list.

A copied repository without its own Git metadata can discover an enclosing Git
root. In the private packaging check, setup exited zero and wrote a patch stamp,
but patch-created owner files were absent. A fixture-only Git discovery ceiling
corrected that incidental context; all installer helpers still matched the
working repository. Verify the actual patched files before runtime checks. A
verbose dry-run from the real Git root against a fresh verified archive checked
all owner hunks without skipped paths. The ceiling-dependent private bootstrap
is not a claim that every production installation layout was exercised.

T3 can reconstruct provider PATH. Executing a CLI loader by shebang selected a
different installed Node despite the driver's pinned PATH. The private launcher
must invoke the selected Node and bundle explicitly; assert both actual paths in
root and child runtime records. Hash the full dist and agent-core trees, not only
the small CLI loader. Preserve the earlier receipt with its actual interpreter
rather than relabeling it after the fixture correction.

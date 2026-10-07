# Session ownership lifecycle

Configure loading through the `extensions` array in `pi/agent/settings.json`.
The entry `./lifecycle/session-lifecycle.ts` resolves relative to the agent
settings directory. Load the guard before ownership-dependent consumers. For a
private test, pass `--extension pi/agent/lifecycle/session-lifecycle.ts` to Pi.

Keep configuration changes in the repository and deploy through `./init.sh --pi`,
not by editing deployed settings. Deployment must include the complete lifecycle
support directory, including `lease.mjs`, `supervisor.mjs` and `owner-client.mjs`.
The entrypoint is outside extension auto-discovery; the settings entry or an
explicit extension argument controls loading. Supported ownership, worker and
terminal boundaries are described below.

## Ownership protocol

Each canonical saved-file path maps to a private `.pi-lifecycle` directory beside
that file. A hashed name identifies a stable SQLite lock database and a separate
owner JSON file. Agent-directory changes cannot create a second lock namespace;
symlink aliases resolve to the same path.

A detached Node supervisor uses built-in `node:sqlite` and holds
`BEGIN IMMEDIATE` for its ownership interval. There are no application tables or
business settings. The database is provisioned once, before SQLite opens it,
and is never unlinked, renamed or replaced by the guard. A holder never reads or
opens/closes the database through ordinary filesystem APIs, which could release
POSIX advisory locks. Metadata remains separate from the database.

The supervisor publishes owner metadata atomically while holding the transaction,
before acknowledging ownership. Publication is synchronous, and release or
parent-disconnect processing is serialized after in-flight initialization. No
metadata callback can finish after unlock. Closed lease objects reject later
publication; repeated release is harmless.

SQLite primary busy code 5, including extended codes whose low byte is 5, means
contention. It never becomes a fail-open initialization error. Corrupt databases,
I/O errors and missing runtime capabilities follow the warning path. An
initialized database with a free lock and missing/malformed owner metadata is an
initialization failure: report the warning and diagnostic, preserve evidence and
signal nobody. Interactive TUI mode also investigates once; caller-driven modes
do not receive unsolicited model turns. A busy lock stays a conflict even when metadata is unreadable.

Acquiring the kernel lock is not proof that the old root stopped. Retained
`preparing`, `active` or `recovery` metadata blocks a contender unless a kernel
PID existence query returns ESRCH while the contender holds the transaction.
A live PID, reused PID, permission failure or uncertain identity stays blocked.
Verified dead roots reopen automatically on the same database inode. Unknown
ownership never authorizes signals.

Explicit release at a quiescent session transition records `released` before
closing SQLite. Parent disconnect records `recovery`, preserving the previous
root identity for retirement checks. A helper exposes a loopback-only endpoint
whose requests must match its canonical file and generation. It verifies its
own direct parent's start identity and inherited IPC before requesting shutdown.
The contender never signals metadata PIDs. An unreachable known owner remains
blocked with its location and actionable guidance.

## Initialization ordering

The protocol uses these states:

1. **Provision/open.** File existence proves nothing about initialization. After
   `BEGIN IMMEDIATE`, inspect a protocol-only SQLite `application_id` marker.
   Marker zero with an empty schema and no previous metadata permits first
   initialization. An unsupported marker/schema is an initialization failure.
   Retained non-released identity prevents a different claimant from overwriting
   it unless that root is verified gone, including when the marker is still zero.
2. **Preparing publication.** While holding the transaction, atomically publish
   a complete `preparing` identity with this generation, root PID and start
   identity. No root admission or ACK is permitted yet.
3. **Marker commit.** Commit the initialization marker only after preparing
   publication completes. SQLite's default durable commit precedes admission.
   The commit temporarily releases the kernel transaction. The retained valid
   preparing identity protects this gap: contenders can inspect it under their
   own transaction, but must refuse admission and must not overwrite it.
4. **Reacquisition.** The initializing handle uses one bounded SQLite busy wait
   to reacquire `BEGIN IMMEDIATE`. There is no sleep/retry loop. It then verifies
   both the marker and its exact preparing generation. Missing/changed evidence
   or timeout never authorizes admission. Release without a held transaction
   leaves preparing evidence unchanged.
5. **Active publication and ACK.** Under the reacquired transaction, publish the
   active identity. Only after publication returns may the supervisor ACK
   ownership. Keep the transaction until a quiescent release or process death.

Crash outcomes must be tested with separate OS processes:

| Crash boundary | Required observation by a contender |
| --- | --- |
| Provision/open, before preparing publication | Marker zero and absent metadata permit a new initializer under the kernel transaction. The previous root was never admitted. |
| Preparing published, before marker commit | Preparing identity prevents overwrite unless the root is verified gone, even if the marker rolled back to zero. |
| Marker committed, before reacquisition | Valid preparing identity prevents overwrite and admission during the free-lock gap. |
| Reacquired, before active publication | Busy until helper death; retained preparing identity blocks until the root is verified gone. |
| Active published, before/after ACK | Busy while held; retained active identity blocks until the root is verified gone. |
| Initialized database, free lock, missing/corrupt metadata | Loud unprotected initialization failure; preserve the evidence, grant no exclusive ownership and signal nobody. |

The marker is infrastructure protocol state, not a database/configuration layer.
The never-unlink/replace rule and prohibition on ordinary-fs database opens in a
holder apply throughout, including automatic verified-dead-owner recovery.

## Runtime behavior

- A conflict blocks ordinary input, model-issued tool calls and user Bash. Its
  modal offers Continue here / Go to existing session / Cancel. Continue asks the
  exact owner's helper to retire its own root, then retries the stable lock for
  a bounded interval using the same verified-unowned contender helper. A failed
  or uncertain handshake cannot authorize helper reuse. Unknown or unreachable ownership stays blocked. The guard
  does not park `before_agent_start` on an indefinitely awaited promise.
- Go supports an unambiguous ordinary terminal client on the same tmux server.
  Control-mode clients are unsupported: tmux pane selection does not prove native
  GUI focus. The contender retains its blocked choice and reports the location.
  For ordinary clients, it
  probes the exact owner before navigation and again after observing that exact
  client on the owner pane. Only then does the contender exit. Unsupported or
  failed navigation reports the location and retains the choice.
- Reopening any previously owned file, including after clean release, retains
  pending admission after lock acquisition. A clean release does not prove the
  contender loaded history after the previous owner's final write. A queued registered command reloads the same saved file using
  `expandPromptTemplates: true`. Admission opens in the guard's replacement
  `session_start`, before later-loaded consumers initialize. This requires an
  active queued switch attempt, its matching resume shutdown, matching previous
  and current files, unchanged generation, and a connected helper. Arbitrary
  same-file startup or reload cannot grant admission. CLI `withSession` runs
  after all startup handlers and is too late for consumer initialization.
  A cancelled replacement stays pending and can retry `/lifecycle-fresh-owner`.
- The supervisor counts clients in every tmux session containing the pane,
  including linked windows. Window selection is not detachment; unrelated
  sessions on the same server do not keep the root alive.
- Last-client loss requests graceful shutdown, then checks the direct parent's
  start identity and inherited IPC connection before bounded TERM/KILL attempts.
  There are no process-group or process-name signals.
- Reload and exact same-file replacement keep the supervisor and transaction.
  Ordinary admission closes before a different-file transition releases them.
- Claim and release handshakes have code-defined deadlines. A wedged helper is
  terminated through its own unreaped child-process handle, never a metadata PID.
  Failure to verify helper exit is reported rather than treated as success.
- Initialization failure writes a private diagnostic and follows `ctx.mode`.
  Interactive `tui` mode displays a persistent unprotected warning and defers one
  automatic investigation until after startup dispatch, preserving supplied
  startup work. Reload does not repeat it or send through a stale runtime.
  `print` and `json` modes report the warning and diagnostic path to stderr,
  then execute only the supplied task. `rpc` reports through its extension UI
  protocol while the caller controls model turns. `ctx.hasUI` is not a mode
  discriminator: both TUI and RPC have dialog-capable UI.
- Release failure during session replacement defers any interactive investigation
  until the fresh runtime exists. Dependent launches remain paused. A known
  conflict never enters the fail-open path merely because cancellation cleanup
  fails.
- Diagnostics omit error messages, environment, arguments and conversation
  contents. They preserve recognized source locations, safe error codes,
  actionable reasons and recovery guidance, and the affected session/state paths.

The fresh-history test schedules a registered command after lifecycle-handler
return with `expandPromptTemplates: true`. `deliverAs` alone does not dispatch a
command. The real CLI test appends a synthetic disk entry absent from the loaded
branch, invokes command-context `switchSession` on the same file, and checks that
the fresh context includes it while ownership metadata stays unchanged. This is
also the mechanism used by the ownership flow. The ownership runtime test writes
history through the old root after the contender opens, then checks the admitted
successor's actual loaded branch, not merely the shared disk file. Later-loaded
startup consumers must observe `owned` and fresh history during replacement
`session_start`; only then can they initialize their test ledger. Both takeover
and automatic dead-root recovery exercise this ordering in the installed CLI.

## Owned worker launch contract

Explicitly load `session-lifecycle.ts` in each owned Pi worker and set the
transient launch environment `PI_LIFECYCLE_OWNER` to JSON:

```json
{"pid":12345,"started":"the original root's ps lstart value","sessionFile":"/canonical/root/session.jsonl","generation":"root admission generation"}
```

The root launcher uses its own PID/start identity and owned admission receipt.
Nested workers forward the original JSON unchanged. They must not substitute
their own receipt or discover a replacement owner from current metadata. This is
launch identity, not a user setting or default activation switch.

A worker's detached helper checks the canonical path, active sidecar generation,
and exact identity returned by the existing owner's probe endpoint before
admission. The authoritative owner helper checks its connected parent's fresh
start identity and held lease on every probe; workers do not duplicate that `ps`
query. Both callers use `owner-client.mjs`, with a 1000 ms UI wall-clock deadline,
500 ms worker wall-clock deadline and 8192-character reply cap. Partial response
bytes do not extend either deadline. The entrypoint loads this support
module inside its protected initialization path so a missing module is reported. It repeats those checks every 250 ms. Missing, changed, unreachable
or ambiguous evidence requests worker shutdown, then uses the existing bounded
TERM/KILL path against only its still-connected, identity-verified direct parent.
The recorded owning-root PID is never signalled. The probe and identity checks
have bounded deadlines; hung-worker tests measure actual root-exit to worker-exit
under five seconds. Workers may complete actions already underway during that
window; unfinished results may be discarded.

Persisted workers retain their own saved-session SQLite lease and report their
own admission receipt. Duplicate saved-session protection remains intact. A
managed worker waits up to five seconds for a conflicting lease to retire,
retrying only contention while original-root monitoring stays active. It then
uses the normal fresh-file replacement before admission. A conflict that remains
at the bound admits no work and stops the unattended worker; it never opens a
takeover menu or retries an infrastructure failure. Ordinary root conflict
choices and initialization deadlines are unchanged.
Fresh-switch command dispatch uses `setImmediate`; `deliverAs: 'followUp'` alone
does not defer extension commands. Starting replacement inside the original
startup dispatch can let the initial task bypass the old runtime's input gate.
After ownership acquisition, a root or worker's initial fresh-reload gate retains
at most its first supplied CLI input in memory, including images. After verified fresh admission, the
command's `withSession` callback sends it once using that fresh runtime's public
API. Keeping the initial input pending until dispatch finishes also prevents
print mode from exiting mid-switch. Cancellation, stop, or a different-session
transition discards it. Conflict input, extension messages, and later user input
are not queued; task files and argv are never re-read or parsed by the guard.

Stateless `--no-session` workers create no lease/session files and report the
original root receipt only after verification. Root monitoring, not tmux client
counts, governs owned-worker lifetime. Worker protection failures stop the worker;
the ordinary root's loud unprotected-chat policy is unchanged.

This adds no central worker registry, parent guardian, memory preservation or
recovery service. Launchers must explicitly load the entrypoint and supply the
association. Independently launched services are not owned Pi workers.

## Public admission query

Cooperating packages query the runtime-local public `pi.events` bus. Load the
guard before consumers. The responder is registered in the factory, so a
later consumer sees `pending` even before asynchronous session startup finishes.
The callback runs synchronously before `emit` returns. This is a snapshot query,
not a generic broker, cross-process RPC, or an authorization token.

```ts
type SessionLifecycleAdmission =
  | { managed: true; status: "owned"; sessionFile: string; generation: string }
  | { managed: true; status: "pending" | "conflict" | "stopping" }
  | { managed: true; status: "unprotected"; reason: string; diagnostic?: string };

interface SessionLifecycleAdmissionRequest {
  respond: (snapshot: SessionLifecycleAdmission) => void;
}

let snapshot: SessionLifecycleAdmission | undefined;
pi.events.emit("session-lifecycle:admission", {
  respond: (value: SessionLifecycleAdmission) => { snapshot = value; },
});
```

The entrypoint exports these types. Runtime consumers need only the public event
name and contract; do not import the guard implementation or inspect its globals.
Responses are fresh frozen objects. An owned receipt contains the canonical
saved-file lease identity and the ownership generation. Both survive `/reload`
and same-file resume, including an existing canonical-path alias. A different
session gets a different receipt. Admission closes to `stopping` before lease
release, requested exit, or a last-client stop. The retiring responder stays
blocked until Pi removes that runtime's event subscriptions.

Consumers must remember that they have observed a managed response across
resource reloads and session replacement, or carry their prior owned receipt.
A successful emit with no responder means unmanaged legacy behavior **only if
that consumer has never observed management and has no expected receipt**. An
exception, ambiguous/multiple replies, missing reply after known management,
`pending`, `conflict`, or `stopping` must not become owned or a legacy fallback.

Before a synchronous shared-ledger/state write, query again and require:

```ts
current?.status === "owned" &&
current.generation === expected.generation &&
current.sessionFile === expected.sessionFile
```

Do not `await` between that recheck and the write. Recheck after asynchronous
preparation, inside the synchronous transaction callback when applicable. A
receipt copied before session replacement cannot authorize work in its successor.
The snapshot reflects observed guard state; it is not a substitute for durable
worker/result ownership or process-incarnation fencing.

`unprotected` reports either an infrastructure failure or an ordinary intentional
in-memory session. `reason` is a safe code; `diagnostic` is the private diagnostic
path for failures when available. Root chat continues under the fail-open policy.
Background consumers pause ownership-dependent dispatch/finalization until they
receive a verified owned receipt.

An ordinary top-level `--no-session` session reports
`{ managed: true, status: "unprotected", reason: "STATELESS_SESSION" }`. Print,
RPC and chat stay usable without a helper, lease, diagnostic or investigation
turn. This is not unmanaged fallback or verified ownership: ownership-dependent
background launch remains paused. Explicitly owned stateless workers are different;
`PI_LIFECYCLE_OWNER` still requires original-root verification and monitoring.

Caller-side gating remains the consumer's responsibility. `session_start` is not
cancellable as a group: a later handler can still execute after Cancel, so it
must query before its side effects. This interface does not control arbitrary
imports, extensions or asynchronous work that ignores/reuses an old receipt.
Team and memory consumers must apply this contract around their own side effects.

## Verification

```bash
# Protocol and extension fixtures only, no tmux:
node --test pi/tests/lifecycle-guard/*.test.mjs

# Complete private-lab suite:
bash pi/test-lifecycle-guard.sh
```

The full runner prints retained evidence directories. It covers real-process
claims, cross-agent-directory aliases, paused stale callbacks after replacement,
actual supervisor SIGKILL with its root still alive, metadata-publication crash
boundaries, malformed metadata, SQLite errors and initialization/disconnect races.
Extension fixtures cover bounded handshakes, teardown admission, missing/broken
helpers, redaction and exactly-once investigation. Admission tests use the actual
SDK event bus and a real later-loaded CLI consumer that gates a shared ledger.
They cover unmanaged legacy behavior, fail-open recognition, canceled startup,
reload/same-file receipt retention, and denial of a prior session's receipt.

Real CLI cases cover fresh same-file history, conflict cancellation, supplied
startup prompts causing no pre-consent requests, relevant-client selection, and
a TERM-resistant blocked root. Every failure scenario also exercises visible
warning, diagnostic and ordinary continued model work. Interactive cases verify
one automatic investigation across reload without dropping supplied startup work;
print and RPC cases verify exactly the supplied request and no investigation turn.

The tests use only private PTYs, a loopback provider and synthetic histories.
They follow the lab's resolved CLI, not the repository SDK package. No native
patches, deployment, GUI or real-history access occurs. Private server/provider
loss is an infrastructure failure, not a product pass; there are no crash-hiding
retries or artificial exit delays.

## Supported boundaries

- Trusted local filesystem with working advisory locks and atomic same-directory
  rename. NFS, network/cloud-synced storage and cross-host coordination are not
  supported claims. Filesystem corruption is an initialization failure.
- Do not rename saved sessions while owned, hard-link saved sessions, replace
  lock files, or manipulate the sidecar directory. Hard links and concurrent
  path replacement are not unified by `realpath`. Same-user hostile mutation is
  outside this cooperative protocol.
- SQLite is experimental in the tested Node runtime. Import/API failures warn
  and fail open; there is no version allowlist or added Python dependency.
- Sidecar publication is process-crash atomic, not a claimed power-loss
  durability guarantee. SQLite marker commit uses its default durability.
  Free-lock unknown metadata fails open loudly; busy-lock unknown stays blocked.
- Active-owner takeover requires root exit before replacement admission. A clean
  different-session transition can release ownership while the prior process
  continues elsewhere. Properly associated workers may stop within five seconds
  after root exit rather than before replacement admission. Launchers must ensure every owned worker receives the entrypoint
  and unchanged original-root association.
  Existing reload/same-file worker cancellation remains unchanged. Unfinished
  work can be lost; durable worker or memory recovery is not part of this MVP.
  Independently launched services are outside owned Pi-worker cleanup.
- Native terminal navigation is unsupported. PID start time plus inherited IPC
  is not a universal OS process handle. Reused PIDs stay conservatively blocked;
  Linux runtime behavior remains untested here.
- Team/memory/subagent hooks must consume the public admission query
  and apply their own generation fencing. Awaited `session_start` handlers are
  not cancellable as a group, so Cancel does not prevent a later handler from
  running. This guard is not a complete gate for arbitrary extension side effects.
- Missing support processes can be reported, but an unloadable entrypoint or
  disabled extensions cannot display this extension's warning.
- Fail-open explicitly permits unprotected work after infrastructure failure. It
  cannot promise exclusivity against unguarded legacy or unprotected runtimes.

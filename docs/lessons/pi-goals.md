# Pi goals package

`shazam-pi-goals` combines task checkpoints and phase diagnostics in a separate
public package. Its core uses Rust and its Pi adapter uses TypeScript. Keep the
Git source pin in `pi/agent/settings.json`; deploy through `init.sh --pi`.
The package's reviewed install script builds with existing Cargo and a C linker.
It does not bootstrap a Rust toolchain. Qualification covers macOS arm64 and the
exact Linux amd64 benchmark images tested with Node 22.23.2. Linux qualification
used a separate pinned Rust 1.88/bullseye builder, leaving task images unchanged.
Native loading and the scripted real lifecycle/identity host passed; this is not
a claim of universal Linux compatibility or better long-running model focus.

The setup mapper previously prepended this repository's Pi path to every package
source. That corrupted a Git URL. `pi/setup.sh` now rewrites only repository-relative
sources, preserving remote sources. `bash pi/test-setup.sh` checks preservation
through actual isolated deployment, alongside existing local-path behavior.

The actual lifecycle host canonicalizes session paths. Comparing its root identity
with a raw `/var` or symlink path rejected a valid owner. Compare canonical identity
and ownership paths, retaining the generation and branch checks. The package's
integration regression and actual-host CLI fixture cover this boundary.

Provider and lifecycle contracts need actual-runtime checks. Pi's Anthropic adapter
projects root object properties and loses a root union schema. Failed requests can
retry without another input event. Session replacement destroys the old extension
instance. The package's runtime fixture checks schema conversion and retry cues;
controlled teardown tests check recorder closure for every shutdown reason.

Canonical-history scans belong off Node's event loop. Async verification requires
serial checkpoint mutations and rechecking owner, branch and cancellation after the
await. Package tests include filesystem waiting and controlled verification races.
Native build and synthetic provider passes establish compatibility, not sustained
model focus or full T3 behavior. Preserve those limits when reporting results.

Model-facing API help matters even when state checks pass. A benchmark replacement
omitted the optional-schema revision field and received a generic rejection.
Explicit null revision for fresh creation, returned revision for updates, and
read/reconcile after uncertainty worked without weakening the core guard. Explicit
verified-completion guidance also closed notes that otherwise stayed pending.
These are observed use mechanisms, not proof of a performance or focus gain.

Do not infer cue absence from saved session history. The context hook inserts
transient cue messages and saved writes set the pending flag; provider delivery
was not captured in the benchmark logs. Scripted fixtures verify that mechanism.
Separate persisted note evidence, context preparation and actual recovery outcomes.

Source and repeatable acceptance commands:
[shazam-pi-goals](https://github.com/Shazambom/shazam-pi-goals), `docs/TASKS.md`,
`scripts/test-runtime.sh`, `test/integration.test.ts`, `test/native-bridge.test.ts`.

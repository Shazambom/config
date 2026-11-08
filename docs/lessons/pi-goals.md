# Pi goals package

`shazam-pi-goals` combines task checkpoints and phase diagnostics in a separate
public package. Its core uses Rust and its Pi adapter uses TypeScript. Keep the
Git source pin in `pi/agent/settings.json`; deploy through `init.sh --pi`.
The package's reviewed install script builds with existing Cargo and a C linker.
It does not bootstrap a Rust toolchain. Qualification currently covers macOS arm64.

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

Source and repeatable acceptance commands:
[shazam-pi-goals](https://github.com/Shazambom/shazam-pi-goals), `docs/TASKS.md`,
`scripts/test-runtime.sh`, `test/integration.test.ts`, `test/native-bridge.test.ts`.

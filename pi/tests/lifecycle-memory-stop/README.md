# Memory worker stop checks

Run `./pi/test-lifecycle-memory-stop.sh` from the repository. Requires the existing
`pi/node_modules` dependencies, Node, jq, curl, tar and git. No setup or deployment
runs. The script downloads the pinned archive, verifies its checksum, applies the
repository patch in a fresh system temporary directory, and prints that directory.
It snapshots and hashes lifecycle resources once. It keeps `results.tap`,
`process-close.jsonl`, `core-snapshot.sha256` and the isolated source for inspection.
The real CLI phase also requires the private lifecycle lab's tmux/Python tools.

The tests import the actual patched launcher, extension, runtime, config, triggers
and ledger through Jiti. The Pi host event/ledger adapter is mocked. Worker processes
are real private Node fixtures, not model sessions or the Pi CLI. They report their
PID only after installing a TERM handler. Controls cover normal completion, delayed
clean cancellation, TERM resistance requiring KILL, pre-aborted launch and spawn
failure. The extension tests start both worker roles and check that shutdown waits,
no new work starts, and no result/cost ledger entries commit after cancellation.
The consolidator's delayed clean exit is later than the observer's exit.

Admission tests cover unmanaged legacy dispatch, sticky managed knowledge, blocked
or ambiguous receipts, inherited original-root metadata and lifecycle-first argv.
The new wiring's RED run failed all 13 admission/argv checks before implementation.

The initial RED run showed the resistant worker surviving the escalation deadline, shutdown
returning before close, a retained abort listener after normal completion, and a
pre-aborted launch resolving instead of rejecting. GREEN checks record close
results and verify every recorded PID is absent with signal 0.

The real CLI phase copies those lifecycle resources into the lab's private agent
folder and loads the guard before its root probe. The probe queries actual root
admission and uses the patched OM argv/env/launcher to start a stateless CLI worker
with the real OM worker extension and the lab's loopback synthetic provider. Its
extra probe holds shutdown open and resists TERM. After a genuine provider request,
the test kills the original root, verifies both PIDs absent within five seconds,
and verifies an unrelated sentinel survives. It then starts another worker through
the same launcher with the dead original receipt and verifies blocked startup, no
new provider request and actual process close. `om-process-close.jsonl` and
`om-snapshot.sha256` live in the printed lab evidence directory. Timing from the
SIGKILL request is a conservative upper bound, not an inferred exit timestamp.

This is not full lifecycle coverage. The CLI root uses a test launch probe rather
than OM's observer clock; the Node tests exercise the actual observer/consolidator
triggers. CLI reload/resume, takeover UI, persisted-worker leases, descendant process
groups and real model services are not covered here. Unfinished results can be lost.
A consolidator may already have written files before cancellation; those writes are
not rolled back. No store, recovery or adoption mechanism is added.

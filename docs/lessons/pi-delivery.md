# Explicit Pi delivery

`init.sh --pi-delivery NEW_RECEIPT` runs Pi setup without terminal changes, then
checks the exact package selected by setup. `pi/rpc-readiness.sh --check-json`
uses the existing manifest and validation branches. It does not install assets.
Only this explicit operation makes failed or unknown RPC checks fatal. Ordinary
setup keeps its warning policy.

The receipt separates setup exit, static artifact observation, and unchecked
entry-point/behavior fields. Setup exit zero is not sufficient. No receipt state
asserts process liveness or authorizes a retry. An interrupted operation may have
already changed files. The caller owns receipt retention.

## What the tests exposed

- The first private real-init test failed because the receipt did not exist. The
  unchanged assertion now rejects setup-zero/unpatched-assets delivery and keeps
  behavior `not_run`. `bash pi/test-delivery.sh --without-check` deliberately
  substitutes a stale good observation and must fail that assertion.
- A separate Bash process preserves setup's `set -e`. Running an installer body
  as an if-tested function would suppress failures. The early-failure control
  checks that an instruction after `false` is never reached.
- A background Bash command defaults stdin to `/dev/null` unless redirected.
  Pass `<&0` when waiting on the owned setup child. The private PTY regression
  exercises real credential prompts and verifies synthetic input was saved;
  noninteractive tests alone missed this compatibility regression.
- Identity mismatches must come from a successful jq observation returning
  `false`, not from jq's exit status. Execution, parse and IO failures leave the
  artifact check unknown. Fault controls keep JSON serialization working while
  failing only the package/core identity read, and distinguish valid mismatches
  from malformed JSON.
- `link` reserves the exact new receipt name from complete JSON. `ln` can instead
  place a link inside an existing directory. Final publication uses a same-parent
  rename and verifies the reservation still identifies the initial file. This is
  not protection against hostile same-user directory replacement or power loss.
- Concurrent setup already races on
  `pi/node_modules/pi-diff-review/src/diff/source.ts.portable`. This change does
  not serialize or repair the installer. Different receipt destinations preserve
  each operation's actual setup failure or success. A shared destination admits
  only one operation and never overwrites an old receipt.
- Installed Pi 1.0.4's Bash tool uses process-group SIGKILL on Unix cancellation.
  Traps cannot guarantee cleanup in that path. Initial complete JSON survives;
  private temporary files may remain. The wrapper forwards catchable signals only
  to its owned Bash child and does not claim to stop arbitrary descendants.

## Verification and limits

`bash pi/test-delivery.sh` snapshots the real init/setup route into a private
repository and HOME. It reuses the native package copier and bootstrap-fixture
pattern. Unrelated installers are stubbed; downloads are denied. It exercises
setup-zero with unpatched assets, static pass, stale/existing receipts, concurrent
attempts, broken observer JSON, unsupported/mixed/missing/changed/symlinked assets,
global-versus-fallback selection, early setup failure, publication failure and
cancellation. Ordinary init and `pi.sh --version` invoke no additional check.

`pi/tests/delivery/runtime.mjs` drives the copied installed bundled CLI through a
loopback scripted provider. The real Bash tool runs init and returns `isError`,
`exit_code`, readable failure output and the matching receipt. `signal.mjs`
separately aborts the installed Bash implementation after actual setup output and
records a direct PID-existence observation. Node is used only for these runtime
API/protocol tests, not the delivery implementation.

Evidence is retained in the test's printed temporary directory, including
`acceptance-command.log`, `failed.json`, `tool-events.jsonl` and
`tool-cancellation.json`. Source changes require a fresh test snapshot. This proves
macOS test behavior, not Linux execution, human acknowledgment, GUI delivery,
network installers, or general worker recovery. Receipt behavior fields remain
unchecked even when the separate runtime test passes.

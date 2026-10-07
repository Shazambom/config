#!/usr/bin/env bash
# Product RED=1; infrastructure/inconclusive=2. Invalid candidates must not look RED.
set -euo pipefail
pi_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
proof="$(mktemp -d "${TMPDIR:-/tmp}/lifecycle-outcomes.XXXXXX")"
echo "Evidence: $proof"
for test in test-lifecycle.sh test-lifecycle-ownership.sh; do
  rc=0
  bash "$pi_dir/$test" --cli "$proof/missing-cli" > "$proof/$test.log" 2>&1 || rc=$?
  [[ $rc == 2 ]] || { echo "FAIL $test classified invalid CLI as exit $rc, expected infrastructure exit 2"; exit 1; }
done
echo 'PASS invalid candidates are infrastructure outcomes, not product RED' | tee "$proof/assertions.txt"

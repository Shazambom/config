#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
evidence="$(mktemp -d "${TMPDIR:-/tmp}/pi-lifecycle-guard.XXXXXX")"
printf 'Evidence: %s\n' "$evidence"
bash "$here/tests/lifecycle-guard/test-runtime-common.sh" 2>&1 | tee "$evidence/cleanup-wrapper.txt"
node --test "$here/tests/lifecycle-guard/"*.test.mjs 2>&1 | tee "$evidence/unit.tap"
for scenario in runtime ownership-runtime startup-prompt failure-startup hung-root; do
  bash "$here/tests/lifecycle-guard/$scenario.sh" 2>&1 | tee "$evidence/$scenario.txt"
done
for scenario in owned conflict unprotected unmanaged; do
  bash "$here/tests/lifecycle-guard/admission-runtime.sh" "$scenario" 2>&1 | tee "$evidence/admission-$scenario.txt"
done
for scenario in filesystem missing broken init-timeout release-timeout unknown-missing unknown-corrupt; do
  bash "$here/tests/lifecycle-guard/failure-runtime.sh" "$scenario" 2>&1 | tee "$evidence/failure-$scenario.txt"
done
bash "$here/test-lifecycle.sh" --extension "$here/agent/lifecycle/session-lifecycle.ts" 2>&1 | tee "$evidence/last-client.txt"

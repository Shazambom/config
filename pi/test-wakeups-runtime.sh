#!/usr/bin/env bash
# Installed CLI acceptance with a loopback provider and real timers/processes.
set -euo pipefail
umask 077
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
evidence="${1:-$(mktemp -d "${TMPDIR:-/tmp}/pi-wakeups-runtime.XXXXXXXX")}"
mkdir -p "$evidence"
evidence="$(cd "$evidence" && pwd)"
candidate="${2:-$here/agent/wakeups/index.ts}"
case "${3:-one-shot}" in
  one-shot) exec node "$here/tests/wakeups-runtime/run.mjs" "$evidence" "$candidate" ;;
  batch) exec node "$here/tests/wakeups-runtime/cli-batch.mjs" "$evidence" "$(dirname "$candidate")/runtime.mjs" ;;
  all)
    node "$here/tests/wakeups-runtime/cli-batch.mjs" "$evidence/batch" "$(dirname "$candidate")/runtime.mjs"
    mkdir -p "$evidence/one-shot" "$evidence/rpc" "$evidence/print"
    node "$here/tests/wakeups-runtime/run.mjs" "$evidence/one-shot" "$candidate"
    for scenario in timers shell lifecycle; do
      node "$here/tests/wakeups-runtime/cli-$scenario.mjs" "$evidence/$scenario" "$candidate"
    done
    node "$here/tests/wakeups-runtime/cli-modes.mjs" "$evidence/rpc" "$candidate" rpc
    node "$here/tests/wakeups-runtime/cli-modes.mjs" "$evidence/print" "$candidate" print
    node "$here/tests/wakeups-runtime/cli-owned.mjs" "$evidence/shutdown" "$candidate" quit
    node "$here/tests/wakeups-runtime/cli-owned.mjs" "$evidence/root-death" "$candidate" kill
    ;;
  *) printf 'Usage: %s [evidence-directory] [candidate-entrypoint] [one-shot|batch|all]\n' "$0" >&2; exit 2 ;;
esac

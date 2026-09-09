#!/usr/bin/env bash
set -euo pipefail
[[ $# == 0 ]] || { echo 'Usage: pi/test-web.sh' >&2; exit 1; }
[[ -n "${GOOGLE_SEARCH_API_KEY:-}" && -n "${GOOGLE_CSE_ID:-}" ]] || {
  echo 'Export GOOGLE_SEARCH_API_KEY and GOOGLE_CSE_ID before running this live test.' >&2
  exit 1
}
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
export PI_CODING_AGENT_DIR="$CONFIG_PI_HOME/agent" PI_OFFLINE=1
node "$repo/pi/tests/web-fixture.mjs" &
pid=$!
start_deadline "$pid" 100
wait "$pid"
stop_deadline

#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
export PI_CODING_AGENT_DIR="$CONFIG_PI_HOME/agent" PI_OFFLINE=1
node "$repo/pi/tests/workflow-fixture.mjs"
source "$repo/pi/command-path.sh"
PI_WORKFLOW_CLI="$(pi_real_command "$repo/pi/node_modules/.bin/pi")" node "$repo/pi/tests/workflow-rpc-fixture.mjs"
actual_cli="$(pi_real_command "$(command -v pi)")"
if [[ "$actual_cli" != "$(pi_real_command "$repo/pi/node_modules/.bin/pi")" ]]; then
  PI_WORKFLOW_CLI="$actual_cli" node "$repo/pi/tests/workflow-rpc-fixture.mjs"
fi

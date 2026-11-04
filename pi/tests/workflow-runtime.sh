#!/usr/bin/env bash
# No setup, installation, credentials, or real provider. Use existing runtimes.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo/pi/command-path.sh"
candidate="${1:-$repo/pi/agent/extensions/claude-skills.ts}"
actual_cli="$(pi_real_command "$(command -v pi)")"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/workflow-runtime.XXXXXX")"
trap 'rm -rf -- "$test_dir"' EXIT
export HOME="$test_dir/home" PI_CODING_AGENT_DIR="$test_dir/agent" PI_OFFLINE=1
mkdir -p "$HOME/.claude/commands" "$PI_CODING_AGENT_DIR/extensions" "$test_dir/project"
cp "$repo/claude/commands/tdd.md" "$HOME/.claude/commands/tdd.md"
cp "$candidate" "$PI_CODING_AGENT_DIR/extensions/claude-skills.ts"
printf '{"prompts":["%s"]}\n' "$HOME/.claude/commands/tdd.md" > "$PI_CODING_AGENT_DIR/settings.json"
cd "$test_dir/project"
PI_WORKFLOW_CLI="$actual_cli" node "$repo/pi/tests/workflow-rpc-fixture.mjs"
PI_WORKFLOW_CLI="$actual_cli" PI_WORKFLOW_NO_SKILLS=1 node "$repo/pi/tests/workflow-rpc-fixture.mjs"
node "$repo/pi/tests/workflow-fixture.mjs"
local_cli="$(pi_real_command "$repo/pi/node_modules/.bin/pi")"
if [[ "$local_cli" != "$actual_cli" ]]; then
  PI_WORKFLOW_CLI="$local_cli" node "$repo/pi/tests/workflow-rpc-fixture.mjs"
fi

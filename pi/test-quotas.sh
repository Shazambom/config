#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
[[ $# -le 1 ]] || fail 'Usage: pi/test-quotas.sh [Pi package directory]'
for name in $(compgen -e); do
  case "$name" in
    *API_KEY*|*TOKEN*|*SECRET*|PI_SUBAGENT*|OM_WORKER|PI_CODING_AGENT_DIR) unset "$name" ;;
  esac
done
export PI_CODING_AGENT_DIR="$CONFIG_PI_HOME/agent" PI_OFFLINE=1
jq -n '{anthropic: {type: "oauth", access: "sk-ant-oat-fixture", refresh: "fixture-refresh", expires: 4102444800000}, "openai-codex": {type: "oauth", access: "codex-fixture", refresh: "fixture-refresh", expires: 4102444800000, accountId: "account-fixture"}}' > "$PI_CODING_AGENT_DIR/auth.json"
cp "$PI_CODING_AGENT_DIR/auth.json" "$test_dir/auth-before.json"
jq -e --arg source "$repo/pi/overrides/quotas.ts" '.packages | any(.[]; type == "object" and .source == $source)' "$PI_CODING_AGENT_DIR/settings.json" >/dev/null
# Exercise a second deployment and verify patch idempotence and credential preservation.
cp "$repo/pi/node_modules/@latentminds/pi-quotas/src/providers/fetch.ts" "$test_dir/fetch-before.ts"
"$repo/init.sh" --pi
cmp "$test_dir/fetch-before.ts" "$repo/pi/node_modules/@latentminds/pi-quotas/src/providers/fetch.ts"
cmp "$test_dir/auth-before.json" "$PI_CODING_AGENT_DIR/auth.json"
node "$repo/pi/tests/quotas-fixture.mjs" "${1:-$repo/pi/node_modules/@earendil-works/pi-coding-agent}" > "$test_dir/quotas.log" 2>&1 &
fixture_pid=$!
start_deadline "$fixture_pid" 60
wait "$fixture_pid" || fail 'Quota fixture failed or timed out'
stop_deadline
grep '^PASS:' "$test_dir/quotas.log" || fail 'Missing quota fixture completion'
cmp "$test_dir/auth-before.json" "$PI_CODING_AGENT_DIR/auth.json"
[[ ! -e "$HOME/.pi/agent/extensions/quotas.json" && ! -e "$PI_CODING_AGENT_DIR/extensions/quotas.json" ]] || fail 'Quota extension unexpectedly wrote feature config'

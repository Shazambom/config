#!/usr/bin/env bash
# Real child/tool execution using a local scripted model, with no paid requests.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
[[ $# == 0 ]] || fail 'Usage: pi/test-extensions.sh'
# Keep the test independent of provider credentials and subagent shell overrides.
for name in $(compgen -e); do
  case "$name" in
    *API_KEY*|*TOKEN*|PI_SUBAGENT*|PI_CODING_AGENT_DIR) unset "$name" ;;
  esac
done
export PI_CODING_AGENT_DIR="$CONFIG_PI_HOME/agent"
export PI_ALLOW_BROWSER_COOKIES=0 FEYNMAN_ALLOW_BROWSER_COOKIES=0
fixture="$PWD/evidence.txt"
printf '%s\n' PORTABLE_PI_CHILD_EVIDENCE > "$fixture"
jq -e --arg prefix "$repo/pi/node_modules/" '
  all(.packages[]; (if type == "string" then . else .source end) | startswith($prefix))
' "$PI_CODING_AGENT_DIR/settings.json" >/dev/null || fail 'Package paths'

# JS is limited to upstream API checks and an HTTP/SSE model fixture. Bash owns
# its lifecycle; a FIFO reports readiness and completion without polling files.
mkfifo "$test_dir/model-status"
exec 3<> "$test_dir/model-status"
node "$repo/pi/tests/model-fixture.mjs" "$fixture" > "$test_dir/model-status" 2> "$test_dir/model.log" &
IFS= read -r -t 30 port <&3 || fail 'Model fixture startup timed out'
case "$port" in ''|*[!0-9]*) fail "Invalid fixture port: $port" ;; esac
jq -n --arg url "http://127.0.0.1:$port/v1" '{providers: {smoke: {
  baseUrl: $url, api: "openai-completions", apiKey: "local-test-only",
  models: [{id: "smoke", contextWindow: 128000, maxTokens: 1024}]
}}}' > "$PI_CODING_AGENT_DIR/models.json"
# The launcher must override ambient browser-cookie opt-ins.
export PI_ALLOW_BROWSER_COOKIES=1 FEYNMAN_ALLOW_BROWSER_COOKIES=1
"$repo/pi.sh" --print --mode json --offline --no-session --no-approve \
  --provider smoke --model smoke --thinking off 'Run the extension smoke test.' \
  > "$test_dir/pi.jsonl" 2> "$test_dir/pi.log" &
pi_pid=$!
start_deadline "$pi_pid" 100
if ! wait "$pi_pid"; then
  tail -n 15 "$test_dir/pi.jsonl" >&2
  fail 'Pi extension execution failed or timed out'
fi
stop_deadline
IFS= read -r -t 5 result <&3 || fail 'Missing fixture completion'
[[ "$result" == PASS ]] || fail "Fixture result: $result"
[[ ! -s "$test_dir/model.log" ]] || fail 'Model fixture assertions failed'
jq -es 'any(.[]; .. | objects | select(.type? == "text") | .text? == "EXTENSIONS_OK")' \
  "$test_dir/pi.jsonl" >/dev/null || fail 'Missing final model response'
if grep -Ei 'Failed to load extension' "$test_dir/pi.log"; then fail 'Extension loading'; fi
printf '%s\n' 'PASS: plugin API checks; foreground/parallel children; restricted tools; model inheritance; evidence reads; loopback-fetch blocking. No paid requests.'

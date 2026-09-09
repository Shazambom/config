#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
[[ $# == 0 ]] || fail 'Usage: pi/test-extensions.sh'
for name in $(compgen -e); do
  case "$name" in
    *API_KEY*|*TOKEN*|*SECRET*|GOOGLE_CSE_ID|GOOGLE_CUSTOM_SEARCH_ENGINE_ID|PI_SUBAGENT*|PI_CODING_AGENT_DIR|TMUX*) unset "$name" ;;
  esac
done
export PI_CODING_AGENT_DIR="$CONFIG_PI_HOME/agent" PI_OFFLINE=1
export PI_BROWSER_PROFILE="$test_dir/browser-profile"
export PATH="$repo/pi/node_modules/.bin:$PATH"
export PI_SUBAGENT_SHELL_READY_DELAY_MS=1000
printf '%s\n' PORTABLE_PI_CHILD_EVIDENCE > evidence.txt
jq -e '
  . as $s | .["observational-memory"].models |
  all(.[]; .provider == $s.defaultProvider and .id == $s.defaultModel and .thinking == $s.defaultThinkingLevel)
' "$PI_CODING_AGENT_DIR/settings.json" >/dev/null || fail 'Memory model does not match configured model'
mkfifo "$test_dir/model-status"
exec 3<> "$test_dir/model-status"
node "$repo/pi/tests/model-fixture.mjs" > "$test_dir/model-status" 2> "$test_dir/model.log" &
IFS= read -r -t 30 port <&3 || fail 'Model fixture startup timed out'
case "$port" in ''|*[!0-9]*) fail "Invalid fixture port: $port" ;; esac
export PI_TEST_URL="http://127.0.0.1:$port"
jq -n --arg url "$PI_TEST_URL/v1" '{providers: {smoke: {
  baseUrl: $url, api: "openai-completions", apiKey: "local-test-only",
  models: [{id: "smoke", contextWindow: 128000, maxTokens: 1024}]
}}}' > "$PI_CODING_AGENT_DIR/models.json"
jq '.defaultProvider = "smoke" | .defaultModel = "smoke" | .defaultThinkingLevel = "off" | .retry.enabled = false | .defaultProjectTrust = "yes"' \
  "$PI_CODING_AGENT_DIR/settings.json" > "$test_dir/settings.json"
mv "$test_dir/settings.json" "$PI_CODING_AGENT_DIR/settings.json"
tmux_socket="$test_dir/tmux.sock"
export TMUX_PANE="$(tmux -S "$tmux_socket" -f /dev/null new-session -d -s fixture -x 220 -y 60 -P -F '#{pane_id}' '/bin/bash --noprofile --norc')"
tmux -S "$tmux_socket" set-option -g default-shell /bin/bash
tmux -S "$tmux_socket" set-option -g default-command '/bin/bash --noprofile --norc'
export TMUX="$(tmux -S "$tmux_socket" display-message -p '#{socket_path},#{pid},0')"
node "$repo/pi/tests/extension-fixture.mjs" > "$test_dir/extensions.log" 2>&1 &
fixture_pid=$!
start_deadline "$fixture_pid" 150
if ! wait "$fixture_pid"; then
  tmux -S "$tmux_socket" list-panes -a -F '#{pane_id}' > "$test_dir/panes"
  while IFS= read -r pane; do tmux -S "$tmux_socket" capture-pane -p -t "$pane" -S -80 >&2; done < "$test_dir/panes"
  fail 'Extension fixture failed or timed out'
fi
stop_deadline
[[ ! -s "$test_dir/model.log" ]] || fail 'Model fixture assertions failed'
grep '^PASS:' "$test_dir/extensions.log" || fail 'Missing fixture completion'

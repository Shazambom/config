#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
unset GOOGLE_SEARCH_API_KEY GOOGLE_API_KEY GOOGLE_CSE_ID GOOGLE_CUSTOM_SEARCH_ENGINE_ID GRAFANA_URL GRAFANA_SERVICE_ACCOUNT_TOKEN
export SHELL=/bin/bash
tmux_socket="$test_dir/prompts.sock"
script="$repo/pi/credential-prompts.sh"

start_case() {
  name="$1"
  case_home="$test_dir/$name-home"
  case_agent="$test_dir/$name-agent"
  mkdir -p "$case_home" "$case_agent"
  printf -v command 'env HOME=%q CONFIG_PI_NO_PROMPT=%q bash %q %q; status=$?; printf "\\nPROMPT_TEST_EXIT:%%s\\n" "$status"; exit "$status"' "$case_home" "${2:-0}" "$script" "$case_agent"
  tmux -S "$tmux_socket" new-session -d -s "$name" -x 220 -y 40
  tmux -S "$tmux_socket" set-option -t "$name" remain-on-exit on
  tmux -S "$tmux_socket" send-keys -t "$name" -l "$command"
  tmux -S "$tmux_socket" send-keys -t "$name" Enter
}

wait_for() {
  local expected="$1" attempt
  for ((attempt=0; attempt<100; attempt++)); do
    tmux -S "$tmux_socket" capture-pane -p -t "$name" -S -200 > "$test_dir/pane.log"
    if grep -Fq "$expected" "$test_dir/pane.log"; then return; fi
    sleep 0.1
  done
  fail "Prompt test timed out: $expected"
}
answer() {
  wait_for "$1:"
  tmux -S "$tmux_socket" send-keys -t "$name" -l "$2"
  tmux -S "$tmux_socket" send-keys -t "$name" Enter
}

start_case empty
answer GOOGLE_SEARCH_API_KEY fixture-google-key
answer GOOGLE_CSE_ID fixture-cse-id
answer GRAFANA_URL https://fixture.invalid
answer GRAFANA_SERVICE_ACCOUNT_TOKEN fixture-grafana-token
wait_for PROMPT_TEST_EXIT:0
if grep -Eq 'fixture-google-key|fixture-cse-id|fixture-grafana-token' "$test_dir/pane.log"; then fail 'Credential echoed'; fi
jq -e '.google_search_api_key == "fixture-google-key" and .google_cse_id == "fixture-cse-id"' "$case_agent/extensions/web-search/auth.json" >/dev/null
jq -e '.mcpServers.grafana.env.GRAFANA_SERVICE_ACCOUNT_TOKEN == "fixture-grafana-token" and .mcpServers.grafana.literalEnv == true' "$case_agent/mcp.json" >/dev/null
for file in "$case_agent/mcp.json" "$case_agent/extensions/web-search/auth.json"; do
  [[ "$(ls -l "$file")" == -rw-------* ]] || fail 'Credential permissions'
done
saved_agent="$case_agent"

mkdir -p "$test_dir/partial-home" "$test_dir/partial-agent"
printf '%s\n' 'export GOOGLE_SEARCH_API_KEY=fixture-from-zshrc' 'touch "$HOME/must-not-execute"' > "$test_dir/partial-home/.zshrc"
cp "$saved_agent/mcp.json" "$test_dir/partial-agent/mcp.json"
start_case partial
answer GOOGLE_CSE_ID fixture-only-missing
wait_for PROMPT_TEST_EXIT:0
if grep -Eq 'GOOGLE_SEARCH_API_KEY:|GRAFANA_URL:|GRAFANA_SERVICE_ACCOUNT_TOKEN:' "$test_dir/pane.log"; then fail 'Prompted for existing credential'; fi
[[ ! -e "$case_home/must-not-execute" ]] || fail 'Sourced .zshrc'
jq -e '.google_search_api_key == "fixture-from-zshrc" and .google_cse_id == "fixture-only-missing"' "$case_agent/extensions/web-search/auth.json" >/dev/null
cmp -s "$saved_agent/mcp.json" "$case_agent/mcp.json" || fail 'Existing MCP config changed'

start_case skipped
for variable in GOOGLE_SEARCH_API_KEY GOOGLE_CSE_ID GRAFANA_URL GRAFANA_SERVICE_ACCOUNT_TOKEN; do answer "$variable" ''; done
wait_for PROMPT_TEST_EXIT:0
[[ ! -e "$case_agent/mcp.json" && ! -e "$case_agent/extensions/web-search/auth.json" ]] || fail 'Saved incomplete credentials'
start_case disabled 1
wait_for PROMPT_TEST_EXIT:0
if grep -q 'Enter skips' "$test_dir/pane.log"; then fail 'Ignored prompt opt-out'; fi
HOME="$case_home" CONFIG_PI_NO_PROMPT=0 bash "$script" "$case_agent" </dev/null 2> "$test_dir/noninteractive.log"
[[ ! -s "$test_dir/noninteractive.log" ]] || fail 'Prompted without a terminal'
printf '%s\n' 'PASS: hidden credential entry, missing-only prompts, read-only .zshrc, skips and noninteractive opt-out'

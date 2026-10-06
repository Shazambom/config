#!/usr/bin/env bash
# Offline real-TUI parent + real extension children. Keeps proof artifacts on success/failure.
# Usage: test-tmux-parent.sh [Pi package directory or CLI] [regular|fullscreen] [--native]
# --native uses the installed iTerm Python API, touches only test-owned sessions.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
for tool in node jq tmux curl; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 2; }; done
[[ $# -le 3 ]] || exit 2
native="${3:-}"
[[ -z "$native" || "$native" == --native ]] || exit 2
source "$repo/pi/command-path.sh"
package="${1:-}"
if [[ -z "$package" ]]; then
  installed="$(command -v pi || true)"
  if [[ -n "$installed" ]]; then package="$(pi_real_command "$installed")";
  else package="$repo/pi/node_modules/@earendil-works/pi-coding-agent"; fi
fi
if [[ ! -e "$package" ]]; then
  [[ $# == 0 ]] || { echo "Pi package/CLI not found: $package" >&2; exit 2; }
  package="$repo/pi/node_modules/@earendil-works/pi-coding-agent"
fi
if [[ -d "$package" ]]; then
  package="$(cd "$package" && pwd)"
  cli="$package/$(jq -er '.bin.pi' "$package/package.json")"
else
  cli="$(pi_real_command "$package")"
fi
mode="${2:-fullscreen}"
case "$mode" in regular|fullscreen) ;; *) exit 2 ;; esac
umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-tmux-parent.XXXXXX")"
socket="$work/tmux.sock"
model_pid=''
native_pid=''
cleanup() {
  status=$?
  trap - EXIT
  tmux -S "$socket" list-panes -a -F '#{pane_id}' > "$work/final-panes" 2>/dev/null || true
  while IFS= read -r pane; do tmux -S "$socket" capture-pane -p -t "$pane" > "$work/final-${pane#%}.txt" 2>/dev/null || true; done < "$work/final-panes"
  if [[ -n "$native_pid" ]]; then
    touch "$work/native-stop"
    # The API helper has its own bounded cleanup and never closes whole windows.
    wait "$native_pid" 2>/dev/null || true
  fi
  tmux -S "$socket" kill-server 2>/dev/null || true
  if [[ -n "$model_pid" ]]; then kill "$model_pid" 2>/dev/null || true; wait "$model_pid" 2>/dev/null || true; fi
  printf 'Proof artifacts: %s\n' "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
fail() { echo "FAIL: $*" | tee -a "$work/assertions.txt" >&2; exit 1; }
mkdir -p "$work/home" "$work/agent/agents" "$work/cwd"
cp "$repo/pi/agent/agents/"*.md "$work/agent/agents/"
# Resolve only local pinned packages. No setup, install, or user settings mutations.
vim="$(jq -r '.[]|select(.name=="pi-vimmode")|.name+"-"+.ref' "$repo/pi/upstream.json")"
sub="$(jq -r '.[]|select(.name=="pi-interactive-subagents")|.name+"-"+.ref' "$repo/pi/upstream.json")"
jq -n --arg vim "$repo/pi/upstream/$vim" --arg sub "$repo/pi/upstream/$sub" --arg mode "$mode" '{packages:[$vim,$sub],defaultProvider:"tmux-proof",defaultModel:"offline",defaultThinkingLevel:"off",defaultProjectTrust:"never",tuiMode:$mode,compaction:{enabled:false},retry:{enabled:false},"observational-memory":{enabled:false}}' > "$work/agent/settings.json"
printf '{}\n' > "$work/agent/auth.json"
jq -n '{"tui.altScreen.top":"ctrl+home","tui.altScreen.bottom":"ctrl+end"}' > "$work/agent/keybindings.json"
node "$repo/pi/tests/tmux-parent-model.mjs" "$work" > "$work/model.log" 2>&1 &
model_pid=$!
for ((i=0;i<100;i++)); do [[ ! -s "$work/port" ]] || break; sleep .1; done
[[ -s "$work/port" ]] || fail 'model startup'
url="http://127.0.0.1:$(< "$work/port")"
jq -n --arg url "$url/v1" '{providers:{"tmux-proof":{baseUrl:$url,api:"openai-completions",apiKey:"synthetic-loopback-only",models:[{id:"offline",contextWindow:128000,maxTokens:4096}]}}}' > "$work/agent/models.json"
# Child tmux shells inherit only this sanitized environment. NODE_OPTIONS enforces loopback TCP.
printf '#!/usr/bin/env bash\ncd %q\nexec %q %q --no-context-files --no-skills --no-prompt-templates --tui-mode %q -e %q\n' "$work/cwd" "$(command -v node)" "$cli" "$mode" "$repo/pi/tests/tmux-parent-probe.mjs" > "$work/parent.sh"
printf 'CLI=%s\nmode=%s\nvim=%s\nsubagents=%s\nsocket=%s\nagentDir=%s\nmodelURL=%s\n' "$cli" "$mode" "$vim" "$sub" "$socket" "$work/agent" "$url" > "$work/launch.txt"
printf 'Proof running: %s\nPrivate client: tmux -S %q attach -t proof\n' "$work" "$socket"
# Retain the exact sanitized launch for later native-client experiments. The loopback
# fixture must be running at modelURL when reusing this script.
printf '#!/usr/bin/env bash\nexec env -i HOME=%q PATH=%q TERM=xterm-256color SHELL=%q PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_TMUX_PROOF=%q NODE_OPTIONS=%q %q -S %q -f /dev/null new-session -d -s proof -x 220 -y 60 %q\n' \
  "$work/home" "$PATH" "$(command -v bash)" "$work/agent" "$work" "--import=\"$repo/pi/tests/tmux-parent-model.mjs\"" "$(command -v tmux)" "$socket" "bash '$work/parent.sh'" > "$work/launch.sh"
bash "$work/launch.sh"
tmux -S "$socket" set-option -g default-shell "$(command -v bash)"
tmux -S "$socket" set-option -g default-command 'bash --noprofile --norc'
parent="$(tmux -S "$socket" display-message -p -t proof '#{pane_id}')"
wait_json() {
  local file="$1" expression="$2" i
  for ((i=0;i<400;i++)); do
    if [[ -s "$work/$file" ]] && jq -es "$expression" "$work/$file" >/dev/null; then return; fi
    sleep .1
  done
  fail "deadline $file $expression"
}
native_phase() {
  [[ -n "$native" ]] || return 0
  printf '%s' "$1" > "$work/native-phase"
  local i
  for ((i=0;i<150;i++)); do
    [[ ! -e "$work/native-error" ]] || fail "native helper: $(< "$work/native-error")"
    [[ ! -e "$work/native-ack-$1" ]] || return 0
    sleep .1
  done
  fail "native snapshot deadline: $1"
}
snapshot() {
  tmux -S "$socket" list-panes -a -F '#{pane_id} #{pane_active} #{pane_width} #{pane_height} #{pane_pid} #{pane_current_command}' > "$work/$1-panes.txt"
  while read -r pane rest; do tmux -S "$socket" capture-pane -p -t "$pane" > "$work/$1-${pane#%}.txt"; done < "$work/$1-panes.txt"
}
focus() { [[ "$(tmux -S "$socket" display-message -p -t proof '#{pane_id}')" == "$parent" ]] || fail 'spawn stole parent focus'; }
wait_json events.jsonl 'any(.[];.event=="ready" and .hasUI==true)'
if [[ -n "$native" ]]; then
  python="$HOME/.config/portable-pi/iterm2-venv/bin/python3"
  [[ -x "$python" ]] || python="$(command -v python3)"
  "$python" "$repo/pi/tests/tmux-parent-native.py" "$work" > "$work/native.log" 2>&1 &
  native_pid=$!
  native_phase initial
  sleep .5
fi
snapshot initial
grep -q HISTORY_499 "$work/initial-${parent#%}.txt" || fail 'history not rendered'
tmux -S "$socket" send-keys -t "$parent" -l 'Run the two children now.'
tmux -S "$socket" send-keys -t "$parent" Enter
wait_json model.jsonl '([.[]|select(.event=="held")|.child]|sort)==["alpha","beta"]'
wait_json events.jsonl '([.[]|select(.event=="tool-result" and .name=="subagent")]|length)==2'
tmux -S "$socket" send-keys -t "$parent" -l 'DRAFT_during_children'
sleep 1
snapshot running
native_phase running
focus
initial_width="$(awk -v pane="$parent" '$1==pane {print $3}' "$work/initial-panes.txt")"
running_width="$(awk -v pane="$parent" '$1==pane {print $3}' "$work/running-panes.txt")"
(( running_width < initial_width && running_width > 20 )) || fail 'parent did not resize for children'
awk '$3<20 || $4<10 {exit 1}' "$work/running-panes.txt" || fail 'unusable pane size'
[[ "$(wc -l < "$work/running-panes.txt" | tr -d ' ')" == 3 ]] || fail 'expected parent and two child panes'
for name in alpha beta; do
  found=0
  while read -r pane rest; do
    [[ "$pane" != "$parent" ]] || continue
    if grep -q "CHILD_${name}_" "$work/running-${pane#%}.txt"; then found=1; fi
  done < "$work/running-panes.txt"
  [[ "$found" == 1 ]] || fail "$name output not visible while running"
done
grep -q DRAFT_during_children "$work/running-${parent#%}.txt" || fail 'draft not visible'
tmux -S "$socket" send-keys -t "$parent" F6
wait_json events.jsonl 'any(.[];.event=="draft" and .text=="DRAFT_during_children")'
if [[ "$mode" == fullscreen ]]; then
  tmux -S "$socket" send-keys -t "$parent" C-Home
  sleep .3
  snapshot reading
  grep -q HISTORY_000 "$work/reading-${parent#%}.txt" || fail 'transcript top not visible'
  tmux -S "$socket" send-keys -t "$parent" -l '_kept'
  sleep .3
  snapshot typing
  grep -q HISTORY_000 "$work/typing-${parent#%}.txt" || fail 'typing moved transcript reading position'
  # Stay at the top through the first completion and its layout resize.
fi
# Release separately, checking actual notification contents, not just pane disappearance.
for name in alpha beta; do
  curl --silent --show-error --fail --noproxy '*' -X POST "$url/release/$name" > "$work/release-$name.txt"
  wait_json events.jsonl "any(.[];.event==\"notification\" and .message.details.name==\"$name\" and (.message|tostring|contains(\"CHILD_${name}_DONE\")))"
  sleep .3
  snapshot "released-$name"
  native_phase "released-$name"
  focus
  if [[ "$name" == alpha ]]; then
    jq -es 'all(.[];.event!="notification" or .message.details.name!="beta")' "$work/events.jsonl" >/dev/null || fail 'beta completed before its release'
    jq -es 'all(.[];.event!="released" or .child!="beta")' "$work/model.jsonl" >/dev/null || fail 'fixture released beta early'
    if [[ "$mode" == fullscreen ]]; then
      grep -q HISTORY_000 "$work/released-alpha-${parent#%}.txt" || fail 'completion resize moved transcript reading position'
      grep -q DRAFT_during_children_kept "$work/released-alpha-${parent#%}.txt" || fail 'completion resize lost visible draft'
      tmux -S "$socket" send-keys -t "$parent" C-End
    fi
  fi
done
tmux -S "$socket" send-keys -t "$parent" F6
sleep .3
expected='DRAFT_during_children'
[[ "$mode" != fullscreen ]] || expected="${expected}_kept"
jq -es --arg expected "$expected" '([.[]|select(.event=="draft")]|last|.text)==$expected and all(.[]|select(.event=="tool-result");.isError!=true and .details.status=="started")' "$work/events.jsonl" >/dev/null || fail 'draft or tool results'
# Bottom of synthetic history must survive splits, rather than jump to its beginning.
grep -q HISTORY_499 "$work/running-${parent#%}.txt" || fail 'split lost transcript bottom'
! grep -q HISTORY_000 "$work/running-${parent#%}.txt" || fail 'split jumped to transcript top'
[[ -s "$work/parent.ansi" ]] || fail 'missing raw parent output'
final_width="$(awk -v pane="$parent" '$1==pane {print $3}' "$work/released-beta-panes.txt")"
[[ "$final_width" == "$initial_width" ]] || fail 'parent width not restored after children finish'
jq -es 'all(.[];.event!="error" and .event!="expired") and any(.[];.event=="parent-results" and (.results|length)>=2)' "$work/model.jsonl" >/dev/null || fail 'model protocol'
[[ ! -s "$work/network-denied.jsonl" ]] || fail 'unexpected external network attempt'
if [[ -n "$native" ]]; then
  native_phase finished
  touch "$work/native-stop"
  wait "$native_pid" || fail "native iTerm: $(< "$work/native-error")"
  native_pid=''
fi
printf 'PASS: real TUI parent, two streaming extension children, draft, focus, separate completion notifications (%s)\n' "$mode" | tee "$work/assertions.txt"

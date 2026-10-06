#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
package="${1:-$repo/pi/node_modules/@earendil-works/pi-coding-agent}"
package="$(cd -- "$package" && pwd)"
cli="$package/$(jq -er '.bin.pi' "$package/package.json")"
mode="${2:-$(jq -r '.tuiMode // "regular"' "$repo/pi/agent/settings.json")}"
case "$mode" in regular|fullscreen) ;; *) exit 2 ;; esac
umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-render-proof.XXXXXX")"
socket="$work/tmux.sock"
cleanup() { tmux -S "$socket" kill-server 2>/dev/null || true; printf 'Render proof artifacts: %s\n' "$work"; }
trap cleanup EXIT
mkdir -p "$work/home" "$work/agent" "$work/cwd"
cp -R "$repo/pi/agent/themes" "$work/agent/themes"
# Keep navigation actions stable across Pi versions with different default keys.
jq -n '{"tui.altScreen.top":"ctrl+home","tui.altScreen.bottom":"ctrl+end"}' > "$work/agent/keybindings.json"
jq --arg root "$repo/pi" --slurpfile upstream "$repo/pi/upstream.json" '
  def path:
    if startswith("../upstream/") then
      ltrimstr("../upstream/") as $name |
      ($upstream[0][] | select(.name == $name)) as $pin |
      $root + "/upstream/" + $name + "-" + $pin.ref
    else $root + ltrimstr("..") end;
  .packages |= map(if type == "string" then path else .source |= path end) |
  .defaultProvider="render-proof" | .defaultModel="offline" | .defaultThinkingLevel="medium" |
  .["observational-memory"].enabled=false | .compaction.enabled=false |
  .skills=[] | .prompts=[] | .defaultProjectTrust="never"
' "$repo/pi/agent/settings.json" > "$work/agent/settings.json"
printf 'globalThis.fetch = async () => { throw new Error("Rendering fixture blocks network"); };\n' > "$work/offline.mjs"
printf '#!/bin/bash\ncd %q\nexec env -i HOME=%q PATH=%q TERM=xterm-256color PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_RENDER_PROOF=%q %q --import %q %q --no-session --no-context-files --no-skills --no-prompt-templates --no-builtin-tools --tui-mode %q -e %q\n' \
  "$work/cwd" "$work/home" "$PATH" "$work/agent" "$work" "$(command -v node)" "$work/offline.mjs" \
  "$cli" "$mode" "$repo/pi/tests/render-stability-probe.mjs" > "$work/run.sh"
tmux -S "$socket" -f /dev/null new-session -d -s proof -x 150 -y 45 "bash '$work/run.sh'"
tmux -S "$socket" set-option -g remain-on-exit on
wait_event() {
  local expression="$1" i
  for ((i=0; i<200; i++)); do
    if [[ -f "$work/events.jsonl" ]] && jq -es "$expression" "$work/events.jsonl" >/dev/null; then return; fi
    sleep 0.1
  done
  tmux -S "$socket" capture-pane -p -t proof > "$work/failure.txt"
  printf 'FAIL: event deadline: %s\n' "$expression" >&2; exit 1
}
snapshot() { tmux -S "$socket" capture-pane -p -t proof > "$work/$1.txt"; }
metrics() {
  jq -Rs --argjson bytes "$(wc -c < "$work/output.ansi")" '{scrollbackClears:([scan("\u001b\\[3J")]|length),screenClears:([scan("\u001b\\[2J")]|length),bytes:$bytes}' "$work/output.ansi" > "$work/$1.json"
}
wait_event 'any(.[]; .event=="ready")'
tmux -S "$socket" send-keys -t proof -l 'run'
tmux -S "$socket" send-keys -t proof Enter
wait_event 'any(.[]; .event=="stream")'
tmux -S "$socket" send-keys -t proof -l 'DRAFT_kept_while_streaming'
wait_event 'any(.[]; .event=="stream-row" and .row>=5)'
# Resize while the provider is still streaming, not only after it finishes.
jq -es 'all(.[]; .event!="settled")' "$work/events.jsonl" >/dev/null
parent="$(tmux -S "$socket" display-message -p -t proof '#{pane_id}')"
child="$(tmux -S "$socket" split-window -d -h -t "$parent" -P -F '#{pane_id}' 'printf "CHILD_PROBE_VISIBLE\n"; read -r finish')"
sleep 0.2
[[ "$(tmux -S "$socket" display-message -p -t proof '#{pane_id}')" == "$parent" ]]
snapshot split
grep -q 'LIVE_ROW_' "$work/split.txt"
grep -q 'DRAFT_kept_while_streaming' "$work/split.txt"
tmux -S "$socket" capture-pane -p -t "$child" > "$work/child.txt"
grep -q CHILD_PROBE_VISIBLE "$work/child.txt"
tmux -S "$socket" kill-pane -t "$child"
sleep 0.2
snapshot restored
grep -q 'LIVE_ROW_' "$work/restored.txt"
grep -q 'DRAFT_kept_while_streaming' "$work/restored.txt"
jq -es 'all(.[]; .event!="settled")' "$work/events.jsonl" >/dev/null
wait_event 'any(.[]; .event=="settled")'
sleep 0.2
snapshot settled
grep -q 'LIVE_ROW_099' "$work/settled.txt"
grep -q 'DRAFT_kept_while_streaming' "$work/settled.txt"
tmux -S "$socket" send-keys -t proof F6
wait_event 'any(.[]; .event=="draft")'
jq -es '
  all(.[]; .event!="error") and
  ([.[]|select(.event=="draft")][-1].text=="DRAFT_kept_while_streaming") and
  ([.[]|select(.event=="tool-start")|.index]|sort)==[0,1,2,3,4,5] and
  ([.[]|select(.event=="tool-start")|.active]|max)>1 and
  ([.[]|select(.event=="tool-progress")]|group_by(.index)|map(map(.step)|sort))==[[0,1,2,3,4,5],[0,1,2,3,4,5],[0,1,2,3,4,5],[0,1,2,3,4,5],[0,1,2,3,4,5],[0,1,2,3,4,5]] and
  ([.[]|select(.event=="model-tool-results")]|length)==1 and
  ([.[]|select(.event=="model-tool-results")][0].results |
    length==6 and all(.[]; .isError==false) and
    ([.[].content[]|select(.type=="text")|.text]|sort)==["TOOL_0 FINAL_RECEIPT","TOOL_1 FINAL_RECEIPT","TOOL_2 FINAL_RECEIPT","TOOL_3 FINAL_RECEIPT","TOOL_4 FINAL_RECEIPT","TOOL_5 FINAL_RECEIPT"])
' "$work/events.jsonl" >/dev/null
metrics settled-metrics
jq . "$work/settled-metrics.json"
jq -e '.scrollbackClears == 0' "$work/settled-metrics.json" >/dev/null || { echo 'FAIL: transcript updates cleared terminal history' >&2; exit 1; }
# Scroll independently of the editor, then type without losing the reading position.
tmux -S "$socket" send-keys -t proof C-Home
sleep 0.2
snapshot top
grep -q 'HISTORY_0 ' "$work/top.txt"
tmux -S "$socket" send-keys -t proof -l '_extra'
sleep 0.2
snapshot reading
grep -q 'HISTORY_0 ' "$work/reading.txt"
grep -q 'DRAFT_kept_while_streaming_extra' "$work/reading.txt"
tmux -S "$socket" send-keys -t proof C-End
sleep 0.2
snapshot bottom
grep -q 'LIVE_ROW_099' "$work/bottom.txt"
grep -q 'DRAFT_kept_while_streaming_extra' "$work/bottom.txt"
metrics metrics
jq -e '.scrollbackClears == 0' "$work/metrics.json" >/dev/null
jq -es 'all(.[]; .event!="error")' "$work/events.jsonl" >/dev/null
printf 'PASS: long transcript, concurrent tool updates, streaming, draft preservation, reading position, detached split and resize\n'

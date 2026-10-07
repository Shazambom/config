#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# check uses authoritative bindings; baseline removes only the new Command aliases.
mode="${1:-check}"
case "$mode" in check|baseline) ;; *) exit 2 ;; esac
[[ "$(uname -s)" == Darwin ]] || { echo 'STOP: clipboard isolation audited for macOS only' >&2; exit 2; }
resolved="$(bash "$repo/pi/tests/lifecycle-lab/lab.sh" resolve)"
cli="$(jq -er .cli <<< "$resolved")"
umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-selection-proof.XXXXXX")"
socket="$work/tmux.sock"
trap 'tmux -S "$socket" kill-server 2>/dev/null || true; printf "Selection proof artifacts: %s\n" "$work"' EXIT
mkdir -p "$work/home" "$work/agent/extensions" "$work/cwd"
cp -R "$repo/pi/agent/themes" "$work/agent/themes"
printf '%s\n' "$resolved" > "$work/cli.json"
cp "$repo/pi/agent/extensions/selection-copy.ts" "$work/agent/extensions/selection-copy.ts"
cp "$repo/pi/agent/keybindings.json" "$work/agent/keybindings.json"
if [[ "$mode" == baseline ]]; then
  jq '. + {"app.clipboard.pasteImage":["ctrl+v"],"tui.editor.undo":["ctrl+-"]}' \
    "$work/agent/keybindings.json" > "$work/keys.json"
  mv "$work/keys.json" "$work/agent/keybindings.json"
fi
vim_ref="$(jq -r '.[]|select(.name=="pi-vimmode")|.ref' "$repo/pi/upstream.json")"
jq --arg vim "$repo/pi/upstream/pi-vimmode-$vim_ref" '.packages=[{source:$vim,skills:[],prompts:[],themes:[]}] |
  .extensions=[] | .skills=[] | .prompts=[] | .compaction.enabled=false | .["observational-memory"].enabled=false |
  .defaultProjectTrust="never"' "$repo/pi/agent/settings.json" > "$work/agent/settings.json"
printf '#!/bin/bash\ncd %q\nexec env -i HOME=%q PATH=%q TERM=xterm-256color PI_CODING_AGENT_DIR=%q PI_SELECTION_PROOF=%q PI_OFFLINE=1 %q --import %q %q --no-session --no-context-files --no-skills --no-prompt-templates --no-tools -e %q\n' \
  "$work/cwd" "$work/home" "$PATH" "$work/agent" "$work" "$(command -v node)" "$repo/pi/tests/command-clipboard.mjs" "$cli" "$repo/pi/tests/selection-copy-probe.mjs" > "$work/run.sh"
tmux -S "$socket" -f /dev/null new-session -d -s proof -x 120 -y 38 "bash '$work/run.sh'"
tmux -S "$socket" set-option -g remain-on-exit on
wait_event() {
  local query="$1" i
  for ((i=0;i<100;i++)); do
    if [[ -f "$work/events.jsonl" ]] && jq -es "$query" "$work/events.jsonl" >/dev/null; then return; fi
    sleep 0.1
  done
  tmux -S "$socket" capture-pane -p -t proof > "$work/failure.txt"
  echo "FAIL: $query" >&2; exit 1
}
key() { tmux -S "$socket" send-keys -t proof "$@"; sleep 0.2; }
state() { key F6; }
wait_event 'any(.[];.event=="ready")'
sleep 0.2
tmux -S "$socket" capture-pane -p -t proof > "$work/before.txt"
# Do not accept a silently failed Vim extension or a different installed runtime.
grep -q 'v1.0.4' "$work/before.txt"
grep -q 'INSERT 1:11' "$work/before.txt"
read -r row col < <(awk 'index($0,"SELECTION_TARGET") {print NR,index($0,"SELECTION_TARGET");exit}' "$work/before.txt")
[[ -n "$row" && -n "$col" ]]
mouse() { local event; printf -v event '\033[<%s;%s;%s%s' "$1" "$2" "$row" "$3"; tmux -S "$socket" send-keys -t proof -l "$event"; }
mouse 0 "$col" M
mouse 32 "$((col+16))" M
mouse 0 "$((col+16))" m
state
jq -es 'all(.[];.event!="copy") and ([.[]|select(.event=="state")][-1] | .selected and .draft=="KEEP_DRAFT")' "$work/events.jsonl" >/dev/null
key -l $'\033[99;9u'
state
jq -es '([.[]|select(.event=="copy")]|map(.text))==["SELECTION_TARGET"] and ([.[]|select(.event=="state")][-1] | .selected and .draft=="KEEP_DRAFT")' "$work/events.jsonl" >/dev/null || { echo 'FAIL: Super+C must copy selected text without clearing the draft' >&2; exit 1; }
printf SELECTION_TARGET > "$work/expected-clipboard.txt"
cmp "$work/expected-clipboard.txt" "$work/clipboard.txt"
# An overlay owns input; Super+C must not copy the selection behind it.
key F7
key -l $'\033[99;9u'
wait_event 'any(.[];.event=="overlay-copy")'
key C-c
wait_event 'any(.[];.event=="overlay-cancel")'
jq -es '[.[]|select(.event=="copy")]|length==1' "$work/events.jsonl" >/dev/null
# A click without dragging clears the selection. Normal clear behavior remains.
mouse 0 "$col" M
mouse 0 "$col" m
state
jq -es '[.[]|select(.event=="state")][-1].selected==false' "$work/events.jsonl" >/dev/null
key -l $'\033[99;9u'
state
jq -es '([.[]|select(.event=="state")][-1].draft=="KEEP_DRAFT") and ([.[]|select(.event=="copy")]|length==1)' "$work/events.jsonl" >/dev/null
key C-c
state
jq -es '([.[]|select(.event=="state")][-1].draft=="") and ([.[]|select(.event=="copy")]|length==1)' "$work/events.jsonl" >/dev/null
# Actual Vim editor, not an input-parser assertion. Controls run in both modes.
assert_draft() { jq -es --arg text "$1" '[.[]|select(.event=="state")][-1].draft==$text' "$work/events.jsonl" >/dev/null; }
key C-v
state
assert_draft PASTE_FIXTURE
key -l $'\033[45;5u'
state
assert_draft ''
key -l $'\033[118;9u'
state
paste_ok=false
if assert_draft PASTE_FIXTURE; then paste_ok=true; fi
# Independently test undo even when Super+V was missing.
if [[ "$paste_ok" == false ]]; then key C-v; fi
key -l $'\033[122;9u'
state
undo_ok=false
if assert_draft ''; then undo_ok=true; fi
printf 'Super+V=%s Super+Z=%s\n' "$paste_ok" "$undo_ok" | tee "$work/result.txt"
[[ "$paste_ok" == true && "$undo_ok" == true ]] || { echo 'FAIL: missing command aliases' >&2; exit 1; }
jq -es 'any(.[];.event=="backend") and any(.[];.event=="files") and any(.[];.event=="image") and any(.[];.event=="paste")' "$work/events.jsonl" >/dev/null
tmux -S "$socket" capture-pane -p -t proof > "$work/after.txt"
echo 'PASS: explicit Super+C selection copy, no copy-on-drag, overlay/no-selection guards, Super+V paste and Super+Z undo in Vim, Ctrl+C/V/- controls. OS clipboard blocked.'

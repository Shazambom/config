#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/pi-vim-scroll.XXXXXX")
socket="$work/tmux.sock"
trap 'tmux -S "$socket" kill-server 2>/dev/null || true; printf "Scroll proof: %s\n" "$work"' EXIT
mkdir -p "$work/agent/extensions" "$work/home" "$work/cwd"
cp -R "$repo/pi/agent/themes" "$work/agent/themes"
cp "$repo/pi/agent/keybindings.json" "$work/agent/keybindings.json"
if [[ -f "$repo/pi/agent/extensions/vim-scroll.ts" ]]; then cp "$repo/pi/agent/extensions/vim-scroll.ts" "$work/agent/extensions/"; fi
vim_ref=$(jq -r '.[]|select(.name=="pi-vimmode")|.ref' "$repo/pi/upstream.json")
jq --arg vim "$repo/pi/upstream/pi-vimmode-$vim_ref" '.packages=[{source:$vim,skills:[],prompts:[],themes:[]}] | .extensions=[] | .skills=[] | .prompts=[] | .compaction.enabled=false | .["observational-memory"].enabled=false | .defaultProjectTrust="never"' "$repo/pi/agent/settings.json" > "$work/agent/settings.json"
resolved=$(bash "$repo/pi/tests/lifecycle-lab/lab.sh" resolve)
cli=$(jq -er .cli <<< "$resolved")
printf '%s\n' "$resolved" > "$work/cli.json"
printf '#!/bin/bash\ncd %q\nexec env -i HOME=%q PATH=%q TERM=xterm-256color PI_CODING_AGENT_DIR=%q PI_SCROLL_PROOF=%q PI_OFFLINE=1 %q --import %q %q --no-session --no-context-files --no-skills --no-prompt-templates --no-tools -e %q\n' \
  "$work/cwd" "$work/home" "$PATH" "$work/agent" "$work" "$(command -v node)" "$repo/pi/tests/copy-paste-universal/offline.mjs" "$cli" "$repo/pi/tests/vim-scroll-probe.mjs" > "$work/run.sh"
tmux -S "$socket" -f /dev/null new-session -d -s proof -x 100 -y 30 "bash '$work/run.sh'"
for ((i=0;i<100;i++)); do
  if [[ -f "$work/events.jsonl" ]] && jq -es 'any(.[];.event=="ready")' "$work/events.jsonl" >/dev/null; then break; fi
  sleep .1
done
key() { tmux -S "$socket" send-keys -t proof "$@"; sleep .2; }
state() { key F6; }
assert_state() { jq -es "[.[]|select(.event==\"state\")][-1] | $1" "$work/events.jsonl" >/dev/null || { echo "FAIL: $1" >&2; exit 1; }; }
state
assert_state '.mode=="insert" and .text=="DRAFT"'
key -l G
state
assert_state '.mode=="insert" and .text=="DRAFTG"'
key Escape
key C-u
state
assert_state '.mode=="normal" and .following==false'
key -l G
state
assert_state '.following==true and .text=="DRAFTG"'
# Extended Shift+G must follow the same path as a legacy uppercase G.
key C-u
key -l $'\033[103;2u'
state
assert_state '.following==true and .text=="DRAFTG"'
# An overlay receives its own G rather than scrolling the conversation.
key C-u
key F7
key -l G
state
assert_state '.following==false and .text=="DRAFTG"'
jq -es 'any(.[];.event=="overlay-G")' "$work/events.jsonl" >/dev/null
key Escape
# dG is an editor operation, not the standalone navigation shortcut.
key -l gg
key -l 0
key -l d
state
assert_state '.pending==true'
key -l G
state
assert_state '.following==false and .pending==false and .mode=="normal"'
echo 'PASS: normal-mode G scrolls bottom; insert G, overlay G, and dG remain editor-owned.'

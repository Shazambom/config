#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v tmux >/dev/null
command -v jq >/dev/null
umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-vimmode-proof.XXXXXX")"
socket="$work/tmux.sock"
trap 'tmux -S "$socket" kill-server 2>/dev/null || true; printf "Vim proof artifacts: %s\n" "$work"' EXIT
mkdir -p "$work/home/.pi/agent/extensions" "$work/cwd"
agent="$work/home/.pi/agent"
# Exercise installed package paths, without copying credentials or real sessions.
jq --argjson candidate "${PI_VIM_CANDIDATE:-0}" '.packages |= map(if $candidate == 1 and type == "object" and (.source | contains("/pi-vimmode-")) then del(.extensions) else . end) |
  .defaultProvider="vim-proof" | .defaultModel="echo" | .defaultThinkingLevel="off" |
  .["observational-memory"].enabled=false | .compaction.enabled=false | .skills=[] | .prompts=[] |
  .defaultProjectTrust="no"' "$HOME/.pi/agent/settings.json" > "$agent/settings.json"
cp -R "$repo/pi/agent/themes" "$agent/themes"
config="$(jq -r '.[] | select(.name=="pi-config") | .ref' "$repo/pi/upstream.json")"
mkdir -p "$agent/extensions/prompt-snippets"
cp -R "$repo/pi/agent/extensions/prompt-snippets/snippets" "$agent/extensions/prompt-snippets/snippets"
ln -s "$repo/pi/upstream/pi-config-$config/extensions/prompt-snippets/index.ts" "$agent/extensions/prompt-snippets/index.ts"
printf 'globalThis.fetch = async () => { throw new Error("Vim fixture blocks network"); };\n' > "$work/offline.mjs"
printf '#!/bin/bash\ncd %q\nexec env -i HOME=%q PATH=%q TERM=xterm-256color PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_VIM_PROOF=%q %q --import %q %q --no-session --no-tools -e %q\n' \
  "$work/cwd" "$work/home" "$PATH" "$agent" "$work/events.jsonl" "$(command -v node)" "$work/offline.mjs" \
  "$repo/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" "$repo/pi/tests/vimmode-probe.mjs" > "$work/run.sh"
tmux -S "$socket" -f /dev/null new-session -d -s proof -x 110 -y 40 "bash '$work/run.sh'"
tmux -S "$socket" set-option -g remain-on-exit on
wait_event() {
  local expression="$1"
  for ((i=0; i<100; i++)); do
    if [[ -f "$work/events.jsonl" ]] && jq -es "$expression" "$work/events.jsonl" >/dev/null; then return; fi
    sleep 0.1
  done
  tmux -S "$socket" capture-pane -p -e > "$work/failure.ansi"
  echo "Timed out: $expression" >&2; exit 1
}
key() { tmux -S "$socket" send-keys -t proof "$@"; sleep 0.12; }
text() { tmux -S "$socket" send-keys -t proof -l "$1"; sleep 0.12; }
snapshot() { tmux -S "$socket" capture-pane -p -e > "$work/$1.ansi"; }
draft() {
  local count
  count="$(jq -s '[.[] | select(.type=="draft")]|length' "$work/events.jsonl")"
  key F6
  wait_event "[.[] | select(.type==\"draft\")]|length > $count"
  jq -es --arg expected "$1" '[.[] | select(.type=="draft")][-1].text == $expected' "$work/events.jsonl" >/dev/null || {
    snapshot failure; echo "Wrong draft, expected: $1" >&2; exit 1;
  }
}
wait_event 'any(.[]; .type=="start")'
sleep 2
snapshot startup
text 'alpha beta gamma'
draft 'alpha beta gamma'
key Escape
text '0dw'
draft 'beta gamma'
text 'ciw'
text 'delta'
key Escape
draft 'delta gamma'
text 'yy'
text 'p'
draft $'delta gamma\ndelta gamma'
text 'u'
draft 'delta gamma'
key M-r
draft $'delta gamma\ndelta gamma'
text 'gg0vll'
snapshot visual-char
grep -Fq $'\033[7m' "$work/visual-char.ansi"
grep -q 'VISUAL 3 chars' "$work/visual-char.ansi"
key Escape
text 'Vj'
snapshot visual-line
grep -Fq $'\033[7m' "$work/visual-line.ansi"
grep -q 'V-LINE' "$work/visual-line.ansi"
key Escape
text '/gamma'
key Enter
snapshot search
text ':%s/gamma/omega/g'
key Enter
snapshot substitution-preview
key Enter
draft $'delta omega\ndelta omega'
snapshot substitution
text ':changelog'
key Enter
snapshot changelog
grep -q 'v0.9.0' "$work/changelog.ansi"
! grep -q 'Changelog unavailable' "$work/changelog.ansi"
key Escape
draft $'delta omega\ndelta omega'
# Ctrl-R remains the snippets menu, not Vim redo.
key C-r
snapshot snippets
grep -q 'Prompt snippets' "$work/snippets.ansi"
key Escape
draft $'delta omega\ndelta omega'
# Test real extension command dispatch with a nonempty draft retained by the UI.
key F7
draft $'delta omega\ndelta omega'
jq -es '[.[]|select(.type=="draft")][-1].custom == false' "$work/events.jsonl" >/dev/null
key F8
draft $'delta omega\ndelta omega'
key F9
wait_event '[.[]|select(.type=="start")]|length==2'
sleep 1
draft $'delta omega\ndelta omega'
snapshot reloaded
key Enter
wait_event 'any(.[]; .type=="end")'
snapshot submitted
jq -es '
  [.[]|select(.type=="input")] as $inputs |
  [.[]|select(.type=="model")] as $models |
  ($inputs|length)==1 and $inputs[0].text=="delta omega\ndelta omega" and $inputs[0].source=="interactive" and
  ($models|length)==1 and ([$models[0].messages[]|select(.role=="user")][-1].content == [{type:"text",text:"delta omega\ndelta omega"}])
' "$work/events.jsonl" >/dev/null
# Escape hatch is also reachable by ordinary insert-mode typing.
text '/vimmode off'
key Enter
text 'plain draft'
draft 'plain draft'
jq -es '[.[]|select(.type=="draft")][-1].custom == false' "$work/events.jsonl" >/dev/null
snapshot disabled
key F8
key Escape
text 'gg0vll'
key C-r
snapshot snippets-visual
grep -q 'Prompt snippets' "$work/snippets-visual.ansi"
key Escape
snapshot visual-restored
grep -q 'VISUAL 3 chars' "$work/visual-restored.ansi"
draft 'plain draft'
key Escape
text '0ddi'
draft ''
for ((line=1; line<=30; line++)); do printf 'large paste line %02d alpha beta gamma\n' "$line"; done > "$work/large.txt"
tmux -S "$socket" load-buffer "$work/large.txt"
tmux -S "$socket" paste-buffer -p -t proof
sleep 0.3
large="$(< "$work/large.txt")"
# Command substitution drops the final newline; Pi's draft does not.
draft "$large"$'\n'
key Escape
snapshot paste-materialized
grep -q 'NORMAL 31:1' "$work/paste-materialized.ansi"
text 'u'
draft ''
key M-r
draft "$large"$'\n'
# Materialization uses public setText: the cursor is now at the end, not the marker.
text 'gg0ciw'
text 'EDIT'
key Escape
large="EDIT${large#large}"
draft "$large"$'\n'
text 'yy'
text 'p'
first="${large%%$'\n'*}"
draft "$first"$'\n'"$large"$'\n'
text 'u'
draft "$large"$'\n'
key M-r
draft "$first"$'\n'"$large"$'\n'
text 'u'
draft "$large"$'\n'
printf '%s\n' "$large" > "$work/large-expected.txt"
key F7
draft "$large"$'\n'
key F8
draft "$large"$'\n'
key F9
wait_event '[.[]|select(.type=="start")]|length==3'
sleep 1
draft "$large"$'\n'
key Enter
wait_event '[.[]|select(.type=="end")]|length==2'
jq -es --rawfile expected "$work/large-expected.txt" '[.[]|select(.type=="model")][-1].messages | [.[]|select(.role=="user")][-1].content == [{type:"text",text:($expected|rtrimstr("\n"))}]' "$work/events.jsonl" >/dev/null
# Collapsed paste amid existing text must survive editor swaps before modal editing.
text 'PREFIX SUFFIX'
key C-a
for ((column=0; column<7; column++)); do key Right; done
tmux -S "$socket" load-buffer "$work/large.txt"
tmux -S "$socket" paste-buffer -p -t proof
sleep 0.3
surrounded="PREFIX $(< "$work/large.txt")"$'\n'"SUFFIX"
draft "$surrounded"
key F7
draft "$surrounded"
key F8
draft "$surrounded"
key F9
wait_event '[.[]|select(.type=="start")]|length==4'
sleep 1
draft "$surrounded"
# Insert-mode Ctrl-R must also keep the draft unchanged.
key C-r
snapshot snippets-insert
grep -q 'Prompt snippets' "$work/snippets-insert.ansi"
key Escape
draft "$surrounded"
key Enter
wait_event '[.[]|select(.type=="end")]|length==3'
printf '%s' "$surrounded" > "$work/surrounded-expected.txt"
jq -es --rawfile expected "$work/surrounded-expected.txt" '[.[]|select(.type=="model")][-1].messages | [.[]|select(.role=="user")][-1].content == [{type:"text",text:$expected}]' "$work/events.jsonl" >/dev/null
text 'busy-proof'
key Enter
wait_event 'any(.[]; .type=="busy")'
key Escape
snapshot busy-first-escape
grep -q NORMAL "$work/busy-first-escape.ansi"
jq -es 'all(.[]; .type!="aborted")' "$work/events.jsonl" >/dev/null
key Escape
wait_event 'any(.[]; .type=="aborted")'
wait_event '[.[]|select(.type=="end")]|length==4'
snapshot busy-aborted
printf 'PASS: installed Pi TUI edits, redo, snippets, large paste preservation, reload, offline receipts, and busy Escape\n'

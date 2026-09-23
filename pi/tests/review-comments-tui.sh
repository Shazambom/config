#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$1"
mkdir -p "$work/home/.pi/agent" "$work/cwd"
work="$(cd "$work" && pwd -P)"
agent="$work/home/.pi/agent"
socket="$work/tmux.sock"
trap 'tmux -S "$socket" kill-server 2>/dev/null || true' EXIT
jq '.packages |= map(select((if type=="string" then . else .source end) | test("pi-vimmode-|pi-diff-review"))) |
  .defaultProvider="review-proof" | .defaultModel="fixture" | .defaultThinkingLevel="off" |
  .compaction.enabled=false | .skills=[] | .prompts=[] | .defaultProjectTrust="never"' "$HOME/.pi/agent/settings.json" > "$agent/settings.json"
cp -R "$repo/pi/agent/themes" "$agent/themes"
config="$(jq -r '.[]|select(.name=="pi-config")|.ref' "$repo/pi/upstream.json")"
mkdir -p "$agent/extensions/prompt-snippets"
cp -R "$repo/pi/agent/extensions/prompt-snippets/snippets" "$agent/extensions/prompt-snippets/snippets"
ln -s "$repo/pi/upstream/pi-config-$config/extensions/prompt-snippets/index.ts" "$agent/extensions/prompt-snippets/index.ts"
git -C "$work/cwd" init -q
printf 'anchor\nold value\ntail\n' > "$work/cwd/sample.txt"
git -C "$work/cwd" add .
git -C "$work/cwd" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm baseline
printf 'anchor\nnew value\ntail\n' > "$work/cwd/sample.txt"
printf 'globalThis.fetch = async () => { throw new Error("Review fixture blocks network"); };\n' > "$work/offline.mjs"
printf '#!/bin/bash\ncd %q\nexec env -i HOME=%q PATH=%q TERM=xterm-256color PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_REVIEW_PROOF=%q %q --import %q %q --no-session --tools review_comments -e %q\n' \
  "$work/cwd" "$work/home" "$PATH" "$agent" "$work/events.jsonl" "$(command -v node)" "$work/offline.mjs" \
  "$repo/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" "$repo/pi/tests/review-comments-tui-probe.mjs" > "$work/run.sh"
tmux -S "$socket" -f /dev/null new-session -d -s proof -x 115 -y 42 "bash '$work/run.sh'"
tmux -S "$socket" set-option -g remain-on-exit on
key() { tmux -S "$socket" send-keys -t proof "$@"; sleep 0.15; }
text() { tmux -S "$socket" send-keys -t proof -l "$1"; sleep 0.15; }
snapshot() { tmux -S "$socket" capture-pane -p -e > "$work/$1.ansi"; }
wait_event() {
  local expression="$1"
  for ((i=0;i<100;i++)); do
    if [[ -f "$work/events.jsonl" ]] && jq -es "$expression" "$work/events.jsonl" >/dev/null; then return; fi
    sleep 0.1
  done
  snapshot failure
  printf 'Timed out: %s\n' "$expression" >&2
  exit 1
}
wait_event 'any(.[];.type=="start")'
sleep 1
text '/view sample.txt'; key Enter
text 'c'; text 'alpha beta'; key Escape; text '0ciw'; text 'delta'; key Escape
text 'u'; key M-r; text 'yyp'; text 'gg0vll'
snapshot visual
 grep -Fq $'\033[7m' "$work/visual.ansi"
key Escape; key C-r
snapshot ctrl-r
! grep -q 'Prompt snippets' "$work/ctrl-r.ansi"
key Enter
store="$work/cwd/.git/pi-diff-review-comments.json"
jq -e '.comments|length==1 and .[0].text=="delta beta\ndelta beta" and .[0].disposition=="open"' "$store" >/dev/null
text 'c'; text 'discard'; key Escape; key Escape
jq -e '.comments[0].text=="delta beta\ndelta beta"' "$store" >/dev/null
text 'c'; key Escape; text 'ggdGi'
for ((line=1;line<=20;line++)); do printf 'paste line %02d\n' "$line"; done > "$work/paste.txt"
tmux -S "$socket" load-buffer "$work/paste.txt"
tmux -S "$socket" paste-buffer -p -t proof
sleep 0.3
key Escape; text 'u'; key M-r
snapshot materialized-paste
key Enter
jq -e --rawfile expected "$work/paste.txt" '.comments[0].text==($expected|rtrimstr("\n"))' "$store" >/dev/null
snapshot view-before-submit
key Enter
wait_event 'any(.[];.type=="end")'
jq -e '.comments[0].disposition=="resolved"' "$store" >/dev/null
jq -es 'any(.[];.type=="result" and .tool=="review_comments" and .isError==false)' "$work/events.jsonl" >/dev/null
text '/view sample.txt'; key Enter
snapshot view-after-resolve
grep -q '0 comments' "$work/view-after-resolve.ansi"
! grep -q 'paste line' "$work/view-after-resolve.ansi"
text 'q'
text '/diff HEAD'; key Enter
snapshot diff-after-view-resolve
grep -q '0 comments' "$work/diff-after-view-resolve.ansi"
text 'c'; text 'diff feedback'; key C-j; text 'second line'; key Enter
snapshot diff-before-submit
key Enter
wait_event '[.[]|select(.type=="end")]|length==2'
jq -e '.comments|length==2 and all(.[];.disposition=="resolved")' "$store" >/dev/null
text '/diff HEAD'; key Enter
snapshot diff-after-resolve
grep -q '0 comments' "$work/diff-after-resolve.ansi"
text 'q'; text '/view sample.txt'; key Enter
snapshot view-after-diff-resolve
grep -q '0 comments' "$work/view-after-diff-resolve.ansi"
text 'q'; text '/vimmode off'; key Enter
text '/view sample.txt'; key Enter
text 'c'; text 'plain fallback'; key Escape
snapshot plain-cancel
grep -q '0 comments' "$work/plain-cancel.ansi"
text 'c'; text 'plain fallback'; key Enter
jq -e '.comments|any(.[];.text=="plain fallback" and .disposition=="open")' "$store" >/dev/null
snapshot plain-saved
printf 'PASS actual Pi TUI: embedded Vim multiline/text objects/yank/paste/undo/redo/visual/cancel, Ctrl-R isolation, mode-off fallback, both submitted prompts resolved by offline provider and absent from both reopened views.\n'

#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# != 1 || "${1:-}" != --run ]]; then
  printf '%s\n' 'Usage: bash pi/test-review-comments-live.sh --run' 'Uses real openai-codex/gpt-6-astra quota and SDK InteractiveMode. Deploy first with ./init.sh --pi. Preserves private proof artifacts.' >&2
  exit 2
fi
command -v tmux >/dev/null
command -v jq >/dev/null
umask 077
work="$(mktemp -d /tmp/pi-review-live.XXXXXX)"
socket="$work/tmux.sock"
cleanup() {
  tmux -S "$socket" capture-pane -p -e -t proof > "$work/final.ansi" 2>/dev/null || true
  tmux -S "$socket" kill-server 2>/dev/null || true
  printf 'Review proof artifacts: %s\n' "$work"
}
trap cleanup EXIT
agent="$work/home/.pi/agent"
mkdir -p "$agent" "$work/cwd" "$work/cache"
# Keep only the deployed packages under test. Never copy credentials.
jq '{piVimMode: .piVimMode, packages: [.packages[] | select((if type=="object" then .source else . end) | test("/pi-vimmode-|/pi-diff-review$"))], defaultProvider:"openai-codex", defaultModel:"gpt-6-astra", defaultThinkingLevel:"low", "observational-memory":{enabled:false}, compaction:{enabled:false}, retry:{enabled:false}, skills:[], prompts:[], defaultProjectTrust:"never", enableInstallTelemetry:false}' "$HOME/.pi/agent/settings.json" > "$agent/settings.json"
jq -e '.packages|length==2' "$agent/settings.json" >/dev/null
printf 'Stable review anchor\ndiff_value=baseline\nview_value=baseline\nkeep=baseline\n' > "$work/cwd/fixture.txt"
printf 'Only read or modify fixture.txt. Apply exactly the requested value change. Keep Stable review anchor, other values, and line order unchanged. Do not commit.\n' > "$work/cwd/AGENTS.md"
git -C "$work/cwd" init -q
git -C "$work/cwd" add fixture.txt AGENTS.md
git -C "$work/cwd" -c user.name=Proof -c user.email=proof@example.invalid -c commit.gpgsign=false commit -qm baseline
printf 'Stable review anchor\ndiff_value=wrong\nview_value=wrong\nkeep=changed\n' > "$work/cwd/fixture.txt"
printf '#!/bin/bash\ncd %q\nexec env -i HOME=%q PATH=%q TERM=xterm-256color XDG_CACHE_HOME=%q PI_CODING_AGENT_DIR=%q PI_REVIEW_PROOF=%q PI_REVIEW_AUTH_PATH=%q PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 %q %q\n' \
  "$work/cwd" "$work/home" "$PATH" "$work/cache" "$agent" "$work" "$HOME/.pi/agent/auth.json" "$(command -v node)" "$repo/pi/tests/review-comments-live.mjs" > "$work/run.sh"
tmux -S "$socket" -f /dev/null new-session -d -s proof -x 150 -y 44 "bash '$work/run.sh'"
tmux -S "$socket" set-option -g remain-on-exit on
snapshot() {
  tmux -S "$socket" capture-pane -p -t proof > "$work/$1.txt"
  tmux -S "$socket" capture-pane -p -e -t proof > "$work/$1.ansi"
}
fail() { snapshot failure; printf 'FAIL: %s\n' "$*" >&2; exit 1; }
key() { tmux -S "$socket" send-keys -t proof "$@"; sleep 0.15; }
text() { tmux -S "$socket" send-keys -t proof -l "$1"; sleep 0.15; }
wait_event() {
  local expression="$1" limit="${2:-150}" i
  for ((i=0; i<limit; i++)); do
    if [[ -f "$work/events.jsonl" ]] && jq -es "$expression" "$work/events.jsonl" >/dev/null; then return; fi
    [[ "$(tmux -S "$socket" display-message -p -t proof '#{pane_dead}')" == 0 ]] || fail 'Pi process exited'
    sleep 0.2
  done
  fail "Timed out: $expression"
}
wait_screen() {
  local needle="$1" i
  for ((i=0; i<100; i++)); do
    snapshot current
    if grep -Fq "$needle" "$work/current.txt"; then return; fi
    sleep 0.1
  done
  fail "Screen missing: $needle"
}
open_review() {
  text "$1"; key Enter
  wait_screen '0 comments'
}
wait_event 'any(.[]; .type=="ready")'
jq -es 'any(.[]; .type=="ready" and .model=="gpt-6-astra" and .provider=="openai-codex" and (.tools|index("review_comments")))' "$work/events.jsonl" >/dev/null || fail 'Production review_comments tool missing'
sleep 1
snapshot startup
round=0
for mode in diff view; do
  round=$((round+1))
  if [[ "$mode" == diff ]]; then command='/diff HEAD'; else command='/view fixture.txt'; fi
  open_review "$command"
  snapshot "$mode-open"
  # Both modes start on the first commentable context line, unchanged by the fix.
  text c
  text "DRAFTNOTE Change ${mode}_value=wrong to ${mode}_value=fixed."
  key Escape
  text 'gg0ciw'
  text "${mode}NOTE"
  key Escape
  snapshot "$mode-vim-change"
  text 'yy'; text p
  snapshot "$mode-vim-paste"
  [[ "$(grep -Fc "${mode}NOTE" "$work/$mode-vim-paste.txt")" == 2 ]] || fail 'Vim yank/paste missing duplicate line'
  text u
  snapshot "$mode-vim-undo"
  [[ "$(grep -Fc "${mode}NOTE" "$work/$mode-vim-undo.txt")" == 1 ]] || fail 'Vim undo did not restore one line'
  key Enter
  wait_screen '1 comments'
  snapshot "$mode-before"
  grep -Fq "${mode}NOTE" "$work/$mode-before.txt" || fail 'Vim edited comment missing'
  ! grep -Fq DRAFTNOTE "$work/$mode-before.txt" || fail 'Vim word replacement failed'
  # Cancelling an edit must retain the saved comment.
  text c; key Escape; text A; text ' CANCELLED'; key Escape; key Escape
  snapshot "$mode-cancel"
  ! grep -Fq CANCELLED "$work/$mode-cancel.txt" || fail 'Cancelled edit leaked'
  key Enter
  wait_event "[.[]|select(.type==\"feedback\")]|length == $round"
  snapshot "$mode-submitted"
  ! grep -Fq '1 comments' "$work/$mode-submitted.txt" || fail 'Submit left review open'
  wait_event "[.[]|select(.type==\"agent_settled\")]|length == $round" 1500
  snapshot "$mode-agent-done"
  jq -es --arg mode "$mode" --argjson round "$round" '
    [.[]|select(.type=="feedback")][$round-1].text as $feedback |
    ($feedback | capture("\\[review_comment id=(?<id>[^ ]+) revision=(?<revision>[^]]+)\\]")) as $ref |
    ($feedback | contains("Stable review anchor")) and
    ($feedback | contains("review_comments")) and ($feedback | contains("resolve")) and
    ($feedback | contains($mode + "NOTE Change " + $mode + "_value=wrong to " + $mode + "_value=fixed.")) and
    any(.[]; .type=="tool_execution_start" and .toolName=="review_comments" and
      .args.action=="resolve" and .args.id==$ref.id and .args.revision==$ref.revision) and
    any(.[]; .type=="tool_execution_end" and .toolName=="review_comments" and .isError==false and
      .result.details.id==$ref.id and .result.details.revision==$ref.revision and .result.details.disposition=="resolved")
  ' "$work/events.jsonl" >/dev/null || fail 'Missing matching production feedback and real resolution tool receipt'
  store="$work/cwd/$(git -C "$work/cwd" rev-parse --git-path pi-diff-review-comments.json)"
  cp "$store" "$work/$mode-store.json"
  jq -es --argjson round "$round" '
    [.[]|select(.type=="feedback")][$round-1].text |
    capture("\\[review_comment id=(?<id>[^ ]+) revision=(?<revision>[^]]+)\\]")
  ' "$work/events.jsonl" > "$work/$mode-reference.json"
  jq -e --slurpfile reference "$work/$mode-reference.json" '
    any(..|objects; .reviewId==$reference[0].id and .revision==$reference[0].revision and
      .submittedRevision==.revision and .disposition=="resolved" and
      .filePath=="fixture.txt" and .startLine==1 and .endLine==1 and .excerpt=="Stable review anchor")
  ' "$store" >/dev/null || fail 'Resolved record was not retained'
  grep -Fxq "${mode}_value=fixed" "$work/cwd/fixture.txt" || fail 'Agent did not fix fixture'
  grep -Fxq 'Stable review anchor' "$work/cwd/fixture.txt" || fail 'Comment anchor changed'
  grep -Fxq 'keep=changed' "$work/cwd/fixture.txt" || fail 'Remaining diff changed'
  ! git -C "$work/cwd" diff --quiet || fail 'Diff emptied'
  # Verify both views, including the shared workspace-comment store.
  for reopen in diff view; do
    if [[ "$reopen" == diff ]]; then command='/diff HEAD'; else command='/view fixture.txt'; fi
    open_review "$command"
    snapshot "$mode-reopen-$reopen"
    ! grep -Fq "${mode}NOTE" "$work/$mode-reopen-$reopen.txt" || fail 'Resolved comment still visible'
    key q
  done
done
# There must be no extra test-authored prompts or resolution reminders.
jq -es '
  . as $events |
  [.[]|select(.type=="input")] as $inputs |
  ($inputs|length)==2 and all($inputs[]; .source=="extension") and
  ([.[]|select(.type=="feedback")]|length)==2 and
  ([.[]|select(.type=="ui_prompt_end")]|length)==6 and
  all(to_entries[]|select(.value.type=="feedback"); .key as $i |
    ([$events[0:$i][]|select(.type=="ui_prompt_start" or .type=="ui_prompt_end")][-1].type)=="ui_prompt_end") and
  all(.[]|select(.type=="tool_execution_start" and .toolName=="review_comments"); . as $call |
    any($events[]; .type=="message_end" and .message.role=="assistant" and
      any(.message.content[]; .type=="toolCall" and .id==$call.toolCallId and .name=="review_comments" and .arguments==$call.args)))
' "$work/events.jsonl" >/dev/null || fail 'Unexpected prompt or UI lifecycle'
git -C "$work/cwd" diff > "$work/final.diff"
cp "$work/cwd/fixture.txt" "$work/final-fixture.txt"
printf 'PASS: real SDK Pi TUI, /diff and /view, Vim editing, model fixes, exact resolution receipts and reopened comment absence\n' | tee "$work/result.log"

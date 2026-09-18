#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "${1:-}" == --run && $# -le 2 ]] || { echo 'Usage: bash claude/test-code-review-live.sh --run [medium|low|fix] (uses configured model quota)' >&2; exit 2; }
case "${2:-medium}" in
  medium) level=medium; invocation='/code-review'; cap=8 ;;
  low) level=low; invocation='/code-review low'; cap=4 ;;
  fix) level=low; invocation='/code-review low --fix'; cap=4 ;;
  *) echo 'Expected medium, low, or fix' >&2; exit 2 ;;
esac
command -v tmux >/dev/null
command -v jq >/dev/null
umask 077
proof="$(mktemp -d /tmp/code-review-proof.XXXXXX)"
for name in $(compgen -e); do
  case "$name" in PI_SUBAGENT*|PI_TEAM_*|TMUX*) unset "$name" ;; esac
done
socket="$proof/tmux.sock"
pid=''
birth=''
cleanup() {
  if [[ -n "$pid" && -n "$birth" && "$(ps -p "$pid" -o lstart= 2>/dev/null)" == "$birth" ]]; then kill "$pid" 2>/dev/null || true; fi
  tmux -S "$socket" kill-server 2>/dev/null || true
}
trap cleanup EXIT
export TMUX_PANE="$(tmux -S "$socket" -f /dev/null new-session -d -s proof -x 180 -y 50 -P -F '#{pane_id}' '/bin/bash --noprofile --norc')"
tmux -S "$socket" set-option -g default-shell /bin/bash
tmux -S "$socket" set-option -g default-command '/bin/bash --noprofile --norc'
export TMUX="$(tmux -S "$socket" display-message -p '#{socket_path},#{pid},0')"
mkdir "$proof/project"
cd "$proof/project"
git -c init.defaultBranch=main init -q
printf '%s\n' '#!/usr/bin/env bash' 'retryable() {' '  local status="$1"' '  [[ "$status" -eq 429 || "$status" -ge 500 ]]' '}' 'retryable "${1:-200}"' > retryable.sh
printf '%s\n' '# Retry policy' 'For valid HTTP status codes, retryable.sh returns success for 429 or 5xx and failure for other codes. Preserve this behavior.' > README.md
git add retryable.sh README.md
git -c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -qm baseline
printf '%s\n' '#!/usr/bin/env bash' 'retryable() {' '  local status="$1"' '  [[ "$status" -eq 429 && "$status" -ge 500 ]]' '}' 'retryable "${1:-200}"' > retryable.sh
git diff HEAD > "$proof/before.patch"
git status --porcelain > "$proof/before.status"
printf 'Proof directory: %s\n' "$proof"
pin="$(jq -r '.[] | select(.name == "pi-interactive-subagents") | .name + "-" + .ref' "$repo/pi/upstream.json")"
mkfifo "$proof/input" "$proof/output"
exec 3<> "$proof/input"
exec 4<> "$proof/output"
CONFIG_PI_NO_PROMPT=1 "$repo/pi.sh" --no-extensions -e "$repo/pi/upstream/$pin/pi-extension/subagents/index.ts" --session "$proof/session.jsonl" --mode rpc < "$proof/input" > "$proof/output" 2> "$proof/stderr.log" &
pid=$!
birth="$(ps -p "$pid" -o lstart=)"
jq -nc --arg message "$invocation" '{id:"review",type:"prompt",message:$message}' >&3
deadline=$((SECONDS + 600))
found=false
while (( SECONDS < deadline )) && IFS= read -r -t "$((deadline - SECONDS))" event <&4; do
  printf '%s\n' "$event" >> "$proof/events.jsonl"
  case "$event" in
    *message_end*)
      if printf '%s\n' "$event" | jq -er --arg level "$level" 'select(.type == "message_end" and .message.role == "assistant") | .message.content | map(select(.type == "text") | .text) | join("\n") | capture("(?s)(?<report>\\{.*\\})").report | fromjson | select(.level == $level and (.findings | type == "array"))' > "$proof/report-candidate.json" 2>/dev/null; then
        cp "$proof/report-candidate.json" "$proof/report.json"
        found=true
        break
      fi ;;
  esac
done
[[ "$found" == true ]] || { echo 'FAIL: no completed review within ten minutes' >&2; exit 1; }
git diff HEAD > "$proof/after.patch"
git status --porcelain > "$proof/after.status"
jq -e --arg level "$level" --argjson cap "$cap" '.level == $level and (.findings | length <= $cap) and all(.findings[]; (.short_summary | length <= 60))' "$proof/report.json" >/dev/null
children="$(jq -es 'map(select(.type == "message" and .message.role == "assistant") | .message.content[] | select(.type == "toolCall" and .name == "subagent")) | length' "$proof/session.jsonl")"
if [[ "$level" == medium ]]; then
  [[ "$children" -ge 9 ]]
  jq -e 'any(.findings[]; (.file | endswith("retryable.sh")) and .line == 4 and .verdict == "CONFIRMED")' "$proof/report.json" >/dev/null
else
  [[ "$children" == 0 ]]
  jq -e 'all(.findings[]; has("verdict") | not)' "$proof/report.json" >/dev/null
fi
if [[ "${2:-}" == fix ]]; then
  for status in 429 500 599; do bash retryable.sh "$status"; done
  if bash retryable.sh 200; then echo 'FAIL: fixed predicate retries 200' >&2; exit 1; fi
  git diff --cached --exit-code
  git show HEAD:README.md | cmp - README.md
  [[ -z "$(git ls-files --others --exclude-standard)" ]]
  jq -e '.findings == []' "$proof/report.json" >/dev/null
else
  cmp "$proof/before.patch" "$proof/after.patch"
  cmp "$proof/before.status" "$proof/after.status"
  jq -e 'any(.findings[]; (.file | endswith("retryable.sh")) and .line == 4)' "$proof/report.json" >/dev/null
fi
printf 'PASS: %s exercised the planted predicate bug with %s subagents; report caps and authorized edit boundaries checked.\n' "$invocation" "$children" | tee "$proof/result.log"

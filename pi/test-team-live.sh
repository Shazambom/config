#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" != --run || $# -gt 2 || ( "${2:-team}" != team && "${2:-team}" != arena ) ]]; then
  printf '%s\n' 'Usage: bash pi/test-team-live.sh --run [team|arena]' 'Uses the current configured model and real account quota. Creates an isolated tmux server; preserves proof artifacts.' >&2
  exit 2
fi
command -v tmux >/dev/null
command -v jq >/dev/null
export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
for name in $(compgen -e); do
  case "$name" in PI_SUBAGENT*|PI_TEAM_*|TMUX*) unset "$name" ;; esac
done
export PI_TEAM_LIVE_PROVIDER="${PI_PROVIDER:-$(jq -r .defaultProvider "$PI_CODING_AGENT_DIR/settings.json")}"
export PI_TEAM_LIVE_MODEL="${PI_MODEL:-$(jq -r .defaultModel "$PI_CODING_AGENT_DIR/settings.json")}"
export PI_TEAM_LIVE_CASE="${2:-team}"
umask 077
proof="$(mktemp -d /tmp/pi-team-live.XXXXXX)"
export PI_TEAM_LIVE_PROOF="$proof"
mkdir "$proof/work"
socket="$proof/tmux.sock"
cleanup() { tmux -S "$socket" kill-server 2>/dev/null || true; }
trap cleanup EXIT
export TMUX_PANE="$(tmux -S "$socket" -f /dev/null new-session -d -s proof -x 180 -y 50 -P -F '#{pane_id}' '/bin/bash --noprofile --norc')"
tmux -S "$socket" set-option -g default-shell /bin/bash
tmux -S "$socket" set-option -g default-command '/bin/bash --noprofile --norc'
export TMUX="$(tmux -S "$socket" display-message -p '#{socket_path},#{pid},0')"
printf 'Proof directory: %s\nModel: %s/%s\n' "$proof" "$PI_TEAM_LIVE_PROVIDER" "$PI_TEAM_LIVE_MODEL" | tee "$proof/result.log"
cd "$proof/work"
node "$repo/pi/tests/team-live.mjs" 2>&1 | tee -a "$proof/result.log"

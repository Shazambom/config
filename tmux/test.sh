#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/portable-tmux.XXXXXX")"
socket="$test_dir/server.sock"
cleanup() {
  tmux -S "$socket" kill-server 2>/dev/null || true
  rm -rf "$test_dir"
}
trap cleanup EXIT
export HOME="$test_dir/home with 'quote \$dollar"
mkdir -p "$HOME"
unset TMUX CONFIG_PI_HOME
printf 'set-option -g history-limit 4321' > "$HOME/.tmux.conf"
bash "$repo/tmux/setup.sh"
cp "$HOME/.tmux.conf" "$test_dir/first.conf"
bash "$repo/tmux/setup.sh"
cmp "$HOME/.tmux.conf" "$test_dir/first.conf"
grep -Fqx 'set-option -g history-limit 4321' "$HOME/.tmux.conf"
cmp "$repo/tmux/tmux.conf" "$HOME/.config/portable-pi/tmux.conf"
tmux -S "$socket" -f "$HOME/.tmux.conf" new-session -d -s fixture
[[ "$(tmux -S "$socket" show-options -gv mouse)" == on ]]
[[ "$(tmux -S "$socket" show-options -gv history-limit)" == 4321 ]]
export TMUX="$(tmux -S "$socket" display-message -p '#{socket_path},#{pid},0')"
tmux set-option -g mouse off
bash "$repo/tmux/setup.sh"
[[ "$(tmux show-options -gv mouse)" == on ]]
export CONFIG_PI_HOME="$test_dir/isolated"
tmux set-option -g mouse off
bash "$repo/tmux/setup.sh"
[[ "$(tmux show-options -gv mouse)" == off ]]
cmp "$HOME/.tmux.conf" "$test_dir/first.conf"
printf '%s\n' 'PASS: tmux startup mouse scrolling, active-server reload, existing config, idempotence, quoted paths and isolated setup.'

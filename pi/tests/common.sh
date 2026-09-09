#!/usr/bin/env bash
# Shared Bash 3.2 test lifecycle. Source from the test entry points.
set -euo pipefail
set -m # Each background job has a process group, including Pi descendants.
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
original_home="$HOME"
case "$(uname -s)" in
  Darwin) export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}" ;;
  Linux) export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright}" ;;
esac
export CONFIG_PI_RUNTIME_DIR="${CONFIG_PI_RUNTIME_DIR:-$HOME/.local/share/config-pi/runtime}"
temp_root="${TMPDIR:-/tmp}"
test_dir="$(mktemp -d "${temp_root%/}/portable pi test.XXXXXX")"
cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then
    for log in "$test_dir"/*.log; do
      [[ ! -f "$log" ]] || tail -n 60 "$log" >&2
    done
  fi
  if [[ -n "${tmux_socket:-}" ]]; then tmux -S "$tmux_socket" kill-server 2>/dev/null || true; fi
  for pid in $(jobs -pr); do
    kill -KILL -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  rm -rf -- "$test_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export CONFIG_PI_HOME="$test_dir/state"
export HOME="$test_dir/home"
mkdir -p "$HOME" "$CONFIG_PI_HOME/agent" "$test_dir/project"
cd "$test_dir/project"
"$repo/init.sh" --pi
source "$repo/pi/runtime.sh"
source "$repo/pi/jq.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
# No GNU timeout dependency. The timer shares a job group with its sleep.
start_deadline() {
  (sleep "$2"; kill -TERM -- "-$1" 2>/dev/null || true) &
  deadline_pid=$!
}
stop_deadline() {
  kill -TERM -- "-$deadline_pid" 2>/dev/null || true
  wait "$deadline_pid" 2>/dev/null || true
}

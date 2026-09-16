#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python="$HOME/.config/portable-pi/iterm2-venv/bin/python3"
[[ "$(uname -s)" == Darwin && -x "$python" ]] || {
  printf '%s\n' 'Run init.sh --pi on macOS before this live iTerm2 test.' >&2
  exit 1
}
exec "$python" "$repo/iterm2/test_live.py" "$@"

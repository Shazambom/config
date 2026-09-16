#!/usr/bin/env bash

iterm2_prepare_tab_reorder() (
  [[ "$(uname -s)" == Darwin && -n "${ITERM_SESSION_ID:-}" && -z "${CONFIG_PI_HOME:-}" ]] || return 0
  local base python work helper_pid reply
  base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  python="$HOME/.config/portable-pi/iterm2-venv/bin/python3"
  if [[ ! -x "$python" || ! -f "$base/reorder.py" ]]; then
    printf '%s\n' 'iTerm2 tab placement helper unavailable; using native tab placement.' >&2
    return 0
  fi
  work="$(umask 077; mktemp -d "${TMPDIR:-/tmp}/pi-iterm-reorder.XXXXXX")"
  trap 'rm -f "$work/ready"; rmdir "$work" 2>/dev/null || true' EXIT
  mkfifo -m 600 "$work/ready"
  exec 3<> "$work/ready"
  "$python" "$base/reorder.py" "$ITERM_SESSION_ID" "$work/ready" </dev/null 3>&- &
  helper_pid=$!
  if IFS= read -r -t 20 reply <&3 && [[ "$reply" == READY ]]; then
    exec 3>&-
    return 0
  fi
  kill "$helper_pid" 2>/dev/null || true
  wait "$helper_pid" 2>/dev/null || true
  exec 3>&-
  printf '%s\n' 'Could not prepare iTerm2 tab placement; using native tab placement.' >&2
)

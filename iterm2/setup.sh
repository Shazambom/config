#!/usr/bin/env bash
set -euo pipefail
[[ -z "${CONFIG_PI_HOME:-}" && "$(uname -s)" == Darwin ]] || exit 0
command -v defaults >/dev/null 2>&1 || exit 0
domain=com.googlecode.iterm2
if [[ "$(defaults read "$domain" LoadPrefsFromCustomFolder 2>/dev/null || true)" == 1 ]]; then
  printf '%s\n' 'iTerm2 uses an external preferences folder; skipping local preference changes.' >&2
  exit 0
fi
changed=false
while read -r key type value expected; do
  if [[ "$(defaults read "$domain" "$key" 2>/dev/null || true)" != "$expected" ]]; then
    defaults write "$domain" "$key" "$type" "$value"
    changed=true
  fi
done <<'PREFERENCES'
OpenTmuxWindowsIn -int 2 2
AutoHideTmuxClientSession -bool true 1
CopySelection -bool false 0
EnableAPIServer -bool true 1
PREFERENCES
if [[ "$changed" == true ]]; then
  printf '%s\n' 'Updated iTerm2: native tmux tabs, buried control sessions, explicit Copy, and the tab-reordering API. If the running app has not started its API, toggle Settings > General > Magic > Enable Python API off and on.' >&2
fi

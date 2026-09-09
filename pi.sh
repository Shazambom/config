#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
headless=false
for arg; do
  case "$arg" in
    -p|--print|--mode|--mode=*|--help|-h|--version|-v|--list-models|--list-models=*) headless=true ;;
  esac
done
if [[ "$headless" == true ]]; then
  CONFIG_PI_NO_PROMPT=1 "$repo/init.sh" --pi
else
  "$repo/init.sh" --pi
fi
# Prefer the user's independently updated Pi. Isolated tests use the lockfile.
pi_binary="$repo/pi/node_modules/.bin/pi"
if [[ -z "${CONFIG_PI_HOME:-}" ]]; then
  if command -v pi >/dev/null 2>&1; then
    pi_binary="$(command -v pi)"
  elif [[ -x "$HOME/.local/bin/pi" ]]; then
    pi_binary="$HOME/.local/bin/pi"
  fi
fi
# init.sh installs the private runtime; select it in this process too.
source "$repo/pi/runtime.sh"
source "$repo/pi/jq.sh"
export PI_CODING_AGENT_DIR="${CONFIG_PI_HOME:-$HOME/.pi}/agent"
export PI_BROWSER_PROFILE="${PI_BROWSER_PROFILE:-$PI_CODING_AGENT_DIR/browser-profile}"
if [[ -z "${TMUX:-}" && -t 0 && -t 1 && "$headless" == false ]]; then
  environment=()
  for name in PATH PI_CODING_AGENT_DIR PI_BROWSER_PROFILE PLAYWRIGHT_BROWSERS_PATH GOOGLE_SEARCH_API_KEY GOOGLE_CSE_ID; do
    if printenv "$name" >/dev/null 2>&1; then environment+=(-e "$name=${!name}"); fi
  done
  exec tmux new-session -c "$PWD" "${environment[@]}" -- "$pi_binary" "$@"
fi
exec "$pi_binary" "$@"

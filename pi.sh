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
  CONFIG_PI_NO_PROMPT=1 "$repo/init.sh" --pi-no-terminal
else
  "$repo/init.sh" --pi
fi
# Prefer the user's independently updated Pi. Isolated tests use the lockfile.
pi_binary="$repo/pi/node_modules/.bin/pi"
if [[ -z "${CONFIG_PI_HOME:-}" ]]; then
  if type -P pi >/dev/null 2>&1; then
    pi_binary="$(type -P pi)"
  elif [[ -x "$HOME/.local/bin/pi" ]]; then
    pi_binary="$HOME/.local/bin/pi"
  fi
fi
source "$repo/pi/command-path.sh"
pi_binary="$(pi_real_command "$pi_binary")"
# init.sh installs the private runtime; select it in this process too.
source "$repo/pi/runtime.sh"
source "$repo/pi/jq.sh"
export PI_CODING_AGENT_DIR="${CONFIG_PI_HOME:-$HOME/.pi}/agent"
export PI_BROWSER_PROFILE="${PI_BROWSER_PROFILE:-$PI_CODING_AGENT_DIR/browser-profile}"
source "$repo/pi/launch-args.sh"
pi_prepare_launch_args "$@"
# Bash 3.2 treats an empty array as unset under nounset.
if [[ $# -gt 0 ]]; then set -- "${pi_launch_args[@]}"; fi
if [[ "$pi_launch_t3" == true ]]; then
  case "$pi_binary" in
    */dist/bundle/cli.js) rpc_package="${pi_binary%/dist/bundle/cli.js}" ;;
    */dist/cli.js) rpc_package="${pi_binary%/dist/cli.js}" ;;
    *) echo 'Cannot verify Pi RPC readiness for this CLI layout; --t3 was not started.' >&2; exit 1 ;;
  esac
  bash "$repo/pi/rpc-readiness.sh" "$rpc_package" --check >&2
fi
if [[ -z "${TMUX:-}" && -t 0 && -t 1 && "$headless" == false ]]; then
  environment=()
  for name in PATH PI_CODING_AGENT_DIR PI_BROWSER_PROFILE PLAYWRIGHT_BROWSERS_PATH GOOGLE_SEARCH_API_KEY GOOGLE_CSE_ID; do
    if printenv "$name" >/dev/null 2>&1; then environment+=(-e "$name=${!name}"); fi
  done
  tmux_command=(tmux)
  if [[ "${TERM_PROGRAM:-}" == iTerm.app ]]; then
    source "$repo/iterm2/launch.sh"
    iterm2_prepare_tab_reorder
    tmux_command+=(-CC)
  fi
  exec "${tmux_command[@]}" new-session -c "$PWD" "${environment[@]}" -- "$pi_binary" "$@"
fi
exec "$pi_binary" "$@"

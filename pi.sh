#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"$repo/init.sh" --pi
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
# Global Pi updates independently; setup owns only custom resources.
# Do not let unrelated shell opt-ins enable browser cookie extraction.
export PI_ALLOW_BROWSER_COOKIES=0
export FEYNMAN_ALLOW_BROWSER_COOKIES=0
# Children inherit the runtime PATH and their own restricted agent directory.
# Do not relaunch pi.sh: it would overwrite that child configuration.
export PI_SUBAGENT_PI_BINARY="$pi_binary"
exec "$pi_binary" "$@"

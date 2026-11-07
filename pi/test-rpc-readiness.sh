#!/usr/bin/env bash
# Private installed-CLI regression; never modifies the active installation.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/command-path.sh"
cli="$(pi_real_command "$(command -v pi)")"
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-rpc-readiness.XXXXXX")"
chmod 700 "$work"
printf 'Artifacts retained: %s\n' "$work"
for name in $(compgen -e); do
  case "$name" in *API_KEY*|*TOKEN*|*SECRET*|PI_SUBAGENT*|PI_TEAM*|PI_LIFECYCLE_OWNER|PI_CODING_AGENT_DIR|TMUX|TMUX_PANE) unset "$name" ;; esac
done
export HOME="$work/home" PI_CODING_AGENT_DIR="$work/agent" PI_OFFLINE=1
mkdir -p "$HOME" "$PI_CODING_AGENT_DIR"
case "${1:-}" in
  --baseline) ;;
  '')
    package="${cli%/dist/bundle/cli.js}"
    [[ "$package" != "$cli" ]] || { echo 'Expected installed bundled CLI' >&2; exit 1; }
    bash "$repo/pi/tests/rpc-readiness/copy-package.sh" "$package" "$work/package"
    bash "$repo/pi/rpc-readiness.sh" "$work/package"
    cli="$work/package/dist/bundle/cli.js"
    ;;
  *) cli="$(pi_real_command "$1")" ;;
esac
printf '%s\n' "$cli" > "$work/cli.txt"
node "$repo/pi/tests/rpc-readiness/runtime.mjs" "$cli" "$work" "$repo/pi/agent/lifecycle/session-lifecycle.ts" "${2:-}"

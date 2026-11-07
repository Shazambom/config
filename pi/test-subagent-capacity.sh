#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
lab="$(mktemp -d "${TMPDIR:-/tmp}/pi-capacity.XXXXXX")"
echo "Evidence: $lab"
source "$repo/pi/command-path.sh"
CAPACITY_TEST_CLI="$(pi_real_command "$(command -v pi)")"
export CAPACITY_TEST_CLI
# Optional second argument is an already-applied source/package root. Never modify it.
if [[ -n "${2:-}" ]]; then
  source_dir="$(cd -- "$2" && pwd -P)"
else
  source "$repo/pi/bootstrap.sh"
  spec="$(jq -c '.[] | select(.name == "pi-interactive-subagents")' "$repo/pi/upstream.json")"
  ref="$(jq -r .ref <<< "$spec")"
  pi_download_verified "https://codeload.github.com/amosblomqvist/pi-interactive-subagents/tar.gz/$ref" "$lab/source.tgz" "$(jq -r .sha256 <<< "$spec")"
  tar -xzf "$lab/source.tgz" -C "$lab"
  source_dir="$lab/pi-interactive-subagents-$ref"
  (cd "$source_dir"; git apply --unidiff-zero "$repo/pi/patches/interactive-subagents.patch")
  ln -s "$repo/pi/node_modules" "$source_dir/node_modules"
fi
for name in $(compgen -e); do
  case "$name" in *API_KEY*|*TOKEN*|*SECRET*|PI_SUBAGENT*|PI_TEAM*|PI_LIFECYCLE*|TMUX*) unset "$name" ;; esac
done
export HOME="$lab/home" PI_CODING_AGENT_DIR="$lab/agent" PI_OFFLINE=1
mkdir -p "$HOME" "$PI_CODING_AGENT_DIR"
node "$repo/pi/tests/subagent-capacity/runtime.mjs" "$source_dir" "$lab" "${1:-all}" 2>&1 | tee "$lab/result.log"
if grep -q '^size or position no space for a new pane' "$lab/result.log"; then
  echo 'FAIL raw handled tmux stderr leaked' >&2; exit 1
fi
if [[ "${1:-all}" == all ]]; then
  if node "$repo/pi/tests/subagent-capacity/runtime.mjs" "$source_dir" "$lab" sensitivity >"$lab/sensitivity.log" 2>&1; then
    echo 'FAIL debounced sensitivity control unexpectedly passed' >&2; exit 1
  fi
  grep -q 'TMUX_PANE_CAPACITY' "$lab/sensitivity.log"
  grep -q 'PASS owned private tmux server and dispatch actors cleaned up' "$lab/sensitivity.log"
  echo 'PASS old/debounced layout fails the same burst assertion'
fi

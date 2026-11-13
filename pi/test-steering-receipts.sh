#!/usr/bin/env bash
# No setup/deployment: real stock Pi actors, synthetic loopback providers, private state.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/command-path.sh"
cli="$(pi_real_command "$(command -v pi)")"
node_bin="$(command -v node)"
tmux_bin="$(command -v tmux)"
jq_bin="$(command -v jq)"
if [[ -n "${1:-}" ]]; then
  [[ ! -e "$1" ]] || { echo 'Use a new evidence directory.' >&2; exit 1; }
  mkdir -p "$1"
  lab="$(cd "$1" && pwd -P)"
else
  lab="$(mktemp -d "${TMPDIR:-/tmp}/pi-steering.XXXXXX")"
fi
printf 'Evidence: %s\n' "$lab"
# Unix socket limits count bytes, not just the final filename. Evidence may be deep.
sockets="$(mktemp -d /tmp/pi-sr.XXXXXX)"
cleanup() {
  for socket in "$sockets"/*.sock; do
    [[ ! -S "$socket" ]] || "$tmux_bin" -S "$socket" kill-server >/dev/null 2>&1 || true
  done
  rm -rf "$sockets"
}
trap cleanup EXIT
if [[ -n "${2:-}" ]]; then
  source_dir="$(cd "$2" && pwd -P)"
else
  source "$repo/pi/bootstrap.sh"
  spec="$(jq -c '.[] | select(.name == "pi-interactive-subagents")' "$repo/pi/upstream.json")"
  ref="$(jq -r .ref <<< "$spec")"
  pi_download_verified "https://codeload.github.com/amosblomqvist/pi-interactive-subagents/tar.gz/$ref" "$lab/source.tgz" "$(jq -r .sha256 <<< "$spec")"
  tar -xzf "$lab/source.tgz" -C "$lab"
  source_dir="$lab/pi-interactive-subagents-$ref"
  (
    unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
    cd "$source_dir"
    export GIT_CEILING_DIRECTORIES="$lab"
    git apply --unidiff-zero "$repo/pi/patches/interactive-subagents.patch"
  )
fi
path="$(dirname "$node_bin"):$(dirname "$tmux_bin"):$(dirname "$jq_bin"):/usr/bin:/bin"
mkdir -p "$lab/driver-home" "$lab/driver-tmp"
env -i PATH="$path" HOME="$lab/driver-home" TMPDIR="$lab/driver-tmp" PI_OFFLINE=1 LANG=en_US.UTF-8 \
  "$node_bin" "$repo/pi/tests/steering-receipts/standalone.mjs" "$source_dir" "$cli" "$lab/standalone" "$sockets" \
  2>&1 | tee "$lab/standalone.log"
for scenario in positive drop oldrun fast notice-error; do
  work="$lab/native-$scenario"
  mkdir -p "$work/home" "$work/agent" "$work/tmp"
  env -i PATH="$path" HOME="$work/home" PI_CODING_AGENT_DIR="$work/agent" TMPDIR="$work/tmp" PI_OFFLINE=1 LANG=en_US.UTF-8 \
    "$node_bin" "$repo/pi/tests/steering-receipts/native.mjs" "$source_dir" "$cli" "$work" "$scenario" \
    > "$work/stdout.log" 2> "$work/stderr.log"
  printf 'PASS controlled native: %s\n' "$scenario"
done
printf 'PASS steering receipts: standalone and controlled native. Evidence: %s\n' "$lab"

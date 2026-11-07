#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/bootstrap.sh"
source "$repo/pi/command-path.sh"
cli="$(pi_real_command "$(command -v pi)")"
artifacts="$(mktemp -d "${TMPDIR:-/tmp}/pi-team-flag.XXXXXX")"
chmod 700 "$artifacts"
printf 'Artifacts retained: %s\n' "$artifacts"
for name in $(compgen -e); do
  case "$name" in *API_KEY*|*TOKEN*|*SECRET*|PI_SUBAGENT*|PI_TEAM*|PI_LIFECYCLE_OWNER|PI_CODING_AGENT_DIR|TMUX|TMUX_PANE) unset "$name" ;; esac
done
export HOME="$artifacts/home" PI_CODING_AGENT_DIR="$artifacts/agent" PI_OFFLINE=1
mkdir -p "$HOME" "$PI_CODING_AGENT_DIR"
if [ "$#" -gt 0 ]; then
  source_dir="$(cd -- "$1" && pwd)"
else
  spec="$(jq -c '.[] | select(.name == "pi-interactive-subagents")' "$repo/pi/upstream.json")"
  ref="$(jq -r .ref <<< "$spec")"
  pi_download_verified "https://codeload.github.com/amosblomqvist/pi-interactive-subagents/tar.gz/$ref" "$artifacts/source.tgz" "$(jq -r .sha256 <<< "$spec")"
  tar -xzf "$artifacts/source.tgz" -C "$artifacts"
  source_dir="$artifacts/pi-interactive-subagents-$ref"
  (cd "$source_dir"; git apply --unidiff-zero "$repo/pi/patches/interactive-subagents.patch")
  ln -s "$repo/pi/node_modules" "$source_dir/node_modules"
fi
printf '%s\n' "$cli" > "$artifacts/cli.txt"
"$cli" --version > "$artifacts/version.txt"
shasum -a 256 "$cli" "$source_dir/pi-extension/subagents/team-extension.ts" "$source_dir/pi-extension/subagents/team.ts" > "$artifacts/hashes.txt"
node "$repo/pi/tests/team-flag/runtime.mjs" "$source_dir" "$cli" "$artifacts" "$repo/pi/agent/lifecycle/session-lifecycle.ts" "${2:-}"

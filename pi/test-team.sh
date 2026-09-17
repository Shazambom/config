#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/bootstrap.sh"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-team.XXXXXX")"
trap 'rm -rf -- "$test_dir"' EXIT
for name in $(compgen -e); do
  case "$name" in *API_KEY*|*TOKEN*|*SECRET*|PI_SUBAGENT*|PI_TEAM*|PI_CODING_AGENT_DIR) unset "$name" ;; esac
done
export HOME="$test_dir/home" PI_CODING_AGENT_DIR="$test_dir/agent" PI_OFFLINE=1
mkdir -p "$HOME" "$PI_CODING_AGENT_DIR"
spec="$(jq -c '.[] | select(.name == "pi-interactive-subagents")' "$repo/pi/upstream.json")"
ref="$(jq -r .ref <<< "$spec")"
sha="$(jq -r .sha256 <<< "$spec")"
pi_download_verified "https://codeload.github.com/amosblomqvist/pi-interactive-subagents/tar.gz/$ref" "$test_dir/source.tgz" "$sha"
tar -xzf "$test_dir/source.tgz" -C "$test_dir"
source_dir="$test_dir/pi-interactive-subagents-$ref"
(cd "$source_dir"; git apply --unidiff-zero "$repo/pi/patches/interactive-subagents.patch")
ln -s "$repo/pi/node_modules" "$source_dir/node_modules"
node "$repo/pi/tests/team-fixture.mjs" "$source_dir"
node "$repo/pi/tests/team-arena-cli.mjs" "$source_dir"

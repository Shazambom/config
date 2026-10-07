#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/om-stop.XXXXXX")"
mkdir -p "$work"
printf 'Artifacts: %s\n' "$work"
ref="$(jq -r '.[] | select(.name=="pi-observational-memory") | .ref' "$repo/pi/upstream.json")"
sha="$(jq -r '.[] | select(.name=="pi-observational-memory") | .sha256' "$repo/pi/upstream.json")"
if [[ ! -f "$work/source.tgz" ]]; then
  curl -fsSL "https://codeload.github.com/amosblomqvist/pi-observational-memory/tar.gz/$ref" -o "$work/source.tgz"
fi
if command -v sha256sum >/dev/null; then actual="$(sha256sum "$work/source.tgz")"; else actual="$(shasum -a 256 "$work/source.tgz")"; fi
[[ "${actual%% *}" == "$sha" ]] || { echo 'Archive checksum mismatch' >&2; exit 1; }
rm -rf "$work/source"
mkdir "$work/source"
tar -xzf "$work/source.tgz" --strip-components=1 -C "$work/source"
(cd "$work/source"; git apply --unidiff-zero "$repo/pi/patches/observational-memory.patch")
ln -s "$repo/pi/node_modules" "$work/source/node_modules"
mkdir -p "$work/agent/lifecycle"
cp "$repo/pi/agent/lifecycle/"* "$work/agent/lifecycle/"
shasum -a 256 "$work/agent/lifecycle/"* > "$work/core-snapshot.sha256"
PI_CODING_AGENT_DIR="$work/agent" OM_STOP_SOURCE="$work/source" OM_STOP_ARTIFACTS="$work" node --test "$repo/pi/tests/lifecycle-memory-stop/"*.test.mjs 2>&1 | tee "$work/results.tap"
bash "$repo/pi/tests/lifecycle-memory-stop/root-runtime.sh" "$work/source" "$work/agent/lifecycle" 2>&1 | tee "$work/root-runtime.log"

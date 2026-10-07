#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
ctl="$here/../lifecycle-lab/lab.sh"
source_tree="$1"
core_snapshot="$2"
created="$(bash "$ctl" create)"
id="$(jq -r .id <<< "$created")"
evidence="$(jq -r .evidence <<< "$created")"
printf '%s\n' "$created"
source "$here/../lifecycle-guard/runtime-common.sh" "$evidence/om-final-status.json"
mkdir -p "$evidence/agent/lifecycle" "$evidence/agent/probes"
cp "$core_snapshot/"* "$evidence/agent/lifecycle/"
cp "$here/root-worker.ts" "$here/worker-probe.ts" "$evidence/agent/probes/"
cp -R "$source_tree" "$evidence/om-source"
ln -s "$repo/pi/node_modules" "$evidence/agent/node_modules"
shasum -a 256 "$evidence/agent/lifecycle/"* "$evidence/agent/probes/"* "$repo/pi/patches/observational-memory.patch" > "$evidence/om-snapshot.sha256"
jq --arg guard "$evidence/agent/lifecycle/session-lifecycle.ts" --arg probe "$evidence/agent/probes/root-worker.ts" '.extensions=[$guard,$probe]' "$evidence/cli.json" > "$evidence/cli-next.json"
mv "$evidence/cli-next.json" "$evidence/cli.json"
lab attach first
lab open root
node "$here/root-proof.mjs" "$evidence" 2>&1 | tee "$evidence/om-root-proof.log"
printf 'PASS patched OM stateless CLI root-death proof: %s\n' "$evidence"

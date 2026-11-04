#!/usr/bin/env bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd)
source "$root/pi/command-path.sh"
cli=$(pi_real_command "$(command -v pi)")
pkg=$(dirname "$(dirname "$(dirname "$cli")")")
[[ $(jq -r .version "$pkg/package.json") == 1.0.4 ]] || { echo 'Requires installed Pi 1.0.4' >&2; exit 1; }
[[ $# -ge 1 ]] || { echo 'Usage: test-wakeups-sandbox.sh EVIDENCE_DIR [--live CASES.json]' >&2; exit 2; }
evidence=$1; shift
mkdir -p "$evidence"
chmod 700 "$evidence"
jq -n --arg sdk "$pkg" --arg cli "$cli" --arg node "$(command -v node)" '{sdkVersion:"1.0.4",sdkPath:$sdk,cli:$cli,node:$node}' > "$evidence/runtime.json"
node "$root/pi/tests/wakeups-sandbox/run.mjs" "$pkg" "$evidence" "$@"

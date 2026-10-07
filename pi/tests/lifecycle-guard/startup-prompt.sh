#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
proof="$(mktemp -d "${TMPDIR:-/tmp}/pi-guard-startup.XXXXXX")"
printf 'Evidence: %s\n' "$proof"
bash "$here/../lifecycle-lab/lab.sh" resolve > "$proof/cli.json"
cli="$(jq -r .cli "$proof/cli.json")"
# Only the separately opened contender receives an initial CLI prompt.
jq -nr --arg cli "$cli" --arg receipt "$proof/injected" '"import {writeFileSync} from \"node:fs\";\nif(process.cwd().includes(\"/contender.\")){process.argv.push(\"SYNTHETIC_UNCONSENTED_STARTUP\");writeFileSync(" + ($receipt|tojson) + ", \"injected\\n\");}\nawait import(" + ($cli|tojson) + ");"' > "$proof/candidate.mjs"
chmod +x "$proof/candidate.mjs"
bash "$here/../../test-lifecycle-ownership.sh" --cli "$proof/candidate.mjs" --extension "$here/../../agent/lifecycle/session-lifecycle.ts" 2>&1 | tee "$proof/ownership.txt"
[[ -f "$proof/injected" ]]
printf 'PASS real contender CLI initial prompt was supplied and caused no pre-consent model request\n'

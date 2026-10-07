#!/usr/bin/env bash
# Actual installed TUI: supplied startup work plus one automatic investigation.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/../lifecycle-lab/lab.sh"
proof="$(mktemp -d "${TMPDIR:-/tmp}/pi-failure-startup.XXXXXX")"
bash "$ctl" resolve > "$proof/cli.json"
cli="$(jq -r .cli "$proof/cli.json")"
jq -nr --arg cli "$cli" '"process.argv.push(\"INTERACTIVE_STARTUP_TASK\");\nawait import(" + ($cli|tojson) + ");"' > "$proof/candidate.mjs"
chmod +x "$proof/candidate.mjs"
jq -nr --arg marker "$proof/reloaded" '"import {writeFileSync} from \"node:fs\"; export default function(pi) { pi.on(\"session_start\", e => { if(e.reason===\"reload\") writeFileSync(" + ($marker|tojson) + ",\"done\"); }); }"' > "$proof/reload.ts"
created="$(bash "$ctl" create --cli "$proof/candidate.mjs" --extension "$here/../../agent/lifecycle/session-lifecycle.ts" --extension "$proof/reload.ts")"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
printf 'Evidence: %s\n%s\n' "$proof" "$created"
source "$here/runtime-common.sh" "$evidence/failure-startup-final-status.json"
printf 'fixture obstruction\n' > "$evidence/histories/.pi-lifecycle"
lab attach client
lab open chat
requests() { jq -s '[.[]|select(.event=="request")|(.body.messages|map(select(.role=="user"))|last|.content|tostring)]' "$evidence/events.jsonl"; }
for ((i=0;i<100;i++)); do
  requests > "$proof/initial-requests.json"
  jq -e 'any(.[];contains("INTERACTIVE_STARTUP_TASK")) and any(.[];contains("Investigate ownership protection failure"))' "$proof/initial-requests.json" >/dev/null && break
  sleep .1
done
lab screen chat > "$proof/startup-screen.txt"
jq -e 'length==2 and any(.[];contains("INTERACTIVE_STARTUP_TASK")) and any(.[];contains("Investigate ownership protection failure"))' "$proof/initial-requests.json" >/dev/null
grep -q 'OWNERSHIP PROTECTION FAILED' "$proof/startup-screen.txt"
lab type chat /reload
lab key chat Enter
for ((i=0;i<100;i++)); do [[ -f "$proof/reloaded" ]] && break; sleep .1; done
[[ -f "$proof/reloaded" ]]
lab type chat AFTER_RELOAD_TASK
lab key chat Enter
for ((i=0;i<100;i++)); do
  requests > "$proof/final-requests.json"
  jq -e 'any(.[];contains("AFTER_RELOAD_TASK"))' "$proof/final-requests.json" >/dev/null && break
  sleep .1
done
jq -e 'length==3 and ([.[]|select(contains("Investigate ownership protection failure"))]|length)==1 and ([.[]|select(contains("INTERACTIVE_STARTUP_TASK"))]|length)==1' "$proof/final-requests.json" >/dev/null
lab screen chat > "$proof/reloaded-screen.txt"
grep -q 'OWNERSHIP PROTECTION FAILED' "$proof/reloaded-screen.txt"
[[ "$(find "$evidence/agent/lifecycle-diagnostics" -name '*.json' | wc -l | tr -d ' ')" == 1 ]]
printf 'PASS TUI supplied startup task survives; warning persists and investigation occurs once across reload\n'

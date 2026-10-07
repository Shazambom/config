#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/../lifecycle-lab/lab.sh"
scenario="${1:-filesystem}"
if [[ $# -gt 0 ]]; then shift; fi
extension="$here/../../agent/lifecycle/session-lifecycle.ts"
expected=EEXIST
if [[ "$scenario" != filesystem && "$scenario" != unknown-missing && "$scenario" != unknown-corrupt ]]; then
  fixture="$(mktemp -d "${TMPDIR:-/tmp}/pi-guard-broken-helper.XXXXXX")"
  mkdir "$fixture/lifecycle"
  cp "$extension" "$fixture/lifecycle/session-lifecycle.ts"
  cp "$here/../../agent/lifecycle/owner-client.mjs" "$fixture/lifecycle/owner-client.mjs"
  extension="$fixture/lifecycle/session-lifecycle.ts"
  expected=SUPERVISOR_EXIT
  case "$scenario" in
    missing) ;;
    broken) printf 'this is not javascript !\n' > "$fixture/lifecycle/supervisor.mjs" ;;
    init-timeout) printf 'process.on("message", () => {});\n' > "$fixture/lifecycle/supervisor.mjs"; expected=GUARD_RELEASE_TIMEOUT ;;
    release-timeout) printf 'process.on("message", m => {if(m.type === "claim") process.send({type:"failure",code:"HELPER_INIT"});});\n' > "$fixture/lifecycle/supervisor.mjs"; expected=GUARD_RELEASE_TIMEOUT ;;
    *) printf 'Unknown scenario: %s\n' "$scenario" >&2; exit 2 ;;
  esac
  printf 'Helper fixture: %s\n' "$fixture"
fi
created="$(bash "$ctl" create --extension "$extension" "$@")"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
printf '%s\n' "$created"
source "$here/runtime-common.sh" "$evidence/guard-final-status.json"
if [[ "$scenario" == filesystem ]]; then printf 'Synthetic initialization obstruction\n' > "$evidence/histories/.pi-lifecycle"; fi
if [[ "$scenario" == unknown-* ]]; then
  expected=OWNER_METADATA_UNVERIFIABLE
  node "$here/prepare-unknown.mjs" "$scenario" "$evidence/histories/chat.jsonl" > "$evidence/unknown-owner-receipt.json"
  metadata="$(jq -r .metadata "$evidence/unknown-owner-receipt.json")"
  if [[ -f "$metadata" ]]; then cp "$metadata" "$evidence/unknown-owner-before"; fi
fi
lab attach first
lab open chat
for ((i=0;i<100;i++)); do lab screen chat > "$evidence/failure-screen"; grep -q 'OWNERSHIP PROTECTION FAILED' "$evidence/failure-screen" && break; sleep .1; done
grep -q 'OWNERSHIP PROTECTION FAILED' "$evidence/failure-screen"
grep -q 'SESSION UNPROTECTED' "$evidence/failure-screen"
for ((i=0;i<100;i++)); do lab saved chat > "$evidence/failure-saved"; grep -q 'assistant: LAB_REPLY Investigate' "$evidence/failure-saved" && break; sleep .1; done
grep -q 'assistant: LAB_REPLY Investigate' "$evidence/failure-saved"
[[ "$(find "$evidence/agent/lifecycle-diagnostics" -type f | wc -l | tr -d ' ')" == 1 ]]
jq -e --arg expected "$expected" '.code == $expected and .env == null' "$evidence/agent/lifecycle-diagnostics/"*.json >/dev/null
lab type chat 'Synthetic ordinary input after protection failure'
lab key chat Enter
for ((i=0;i<100;i++)); do lab saved chat > "$evidence/failure-saved"; grep -q 'assistant: LAB_REPLY Synthetic ordinary input' "$evidence/failure-saved" && break; sleep .1; done
grep -q 'assistant: LAB_REPLY Synthetic ordinary input' "$evidence/failure-saved"
lab screen chat > "$evidence/failure-persistent-screen"
grep -q 'OWNERSHIP PROTECTION FAILED' "$evidence/failure-persistent-screen"
[[ "$(grep -c '^user: Investigate' "$evidence/failure-saved")" == 1 ]]
if [[ "$scenario" == unknown-* ]]; then
  jq -e '.reason | test("free.*metadata"; "i")' "$evidence/agent/lifecycle-diagnostics/"*.json >/dev/null
  jq -e '.nextSteps | test("Do not delete")' "$evidence/agent/lifecycle-diagnostics/"*.json >/dev/null
  if grep -q SYNTHETIC_OWNER_SECRET "$evidence/agent/lifecycle-diagnostics/"*.json; then exit 1; fi
  if [[ "$scenario" == unknown-missing ]]; then [[ ! -e "$metadata" ]]; else cmp "$metadata" "$evidence/unknown-owner-before"; fi
  database="$(jq -r .database "$evidence/unknown-owner-receipt.json")"
  [[ "$(ls -di "$database" | awk '{print $1}')" == "$(jq -r .inode "$evidence/unknown-owner-receipt.json")" ]]
fi
printf 'PASS %s stays visibly unprotected, writes diagnostic, investigates once, and accepts ordinary model work\n' "$scenario"

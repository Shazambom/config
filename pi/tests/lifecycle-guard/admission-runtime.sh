#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/../lifecycle-lab/lab.sh"
scenario="${1:-owned}"
case "$scenario" in owned|conflict|unprotected|unmanaged) ;; *) exit 2 ;; esac
extensions=()
if [[ "$scenario" != unmanaged ]]; then extensions+=(--extension "$here/../../agent/lifecycle/session-lifecycle.ts"); fi
extensions+=(--extension "$here/admission-consumer.ts")
created="$(bash "$ctl" create "${extensions[@]}")"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
printf '%s\n' "$created"
source "$here/runtime-common.sh" "$evidence/admission-final-status.json"
if [[ "$scenario" == unprotected ]]; then printf 'synthetic failure\n' > "$evidence/histories/.pi-lifecycle"; fi
lab attach first
lab open chat
for ((i=0;i<100;i++)); do lab screen chat > "$evidence/admission-ready-screen"; grep -q offline "$evidence/admission-ready-screen" && break; sleep .1; done
pid="$(jq -r .pid "$evidence/actors/pi-chat.json")"
audit="$evidence/agent/admission-audit.jsonl"
ledger="$evidence/agent/admission-ledger.jsonl"
# The editor can render before asynchronous guard startup completes. Observe
# the consumer's actual startup callback, not a derived UI readiness hint.
for ((i=0;i<100;i++)); do
  if [[ -f "$audit" ]] && jq -es --argjson pid "$pid" 'any(.[]; .pid == $pid and .stage == "start:startup")' "$audit" >/dev/null; then break; fi
  sleep .1
done
if [[ "$scenario" == unmanaged ]]; then
  jq -es --argjson pid "$pid" 'any(.[]; .pid == $pid and .stage == "start:startup" and .receipt.status == "unmanaged" and .allowed)' "$audit" >/dev/null
elif [[ "$scenario" == unprotected ]]; then
  jq -es --argjson pid "$pid" 'any(.[]; .pid == $pid and .stage == "start:startup" and .receipt.status == "unprotected" and (.allowed|not))' "$audit" >/dev/null
  [[ ! -e "$ledger" ]]
else
  jq -es --argjson pid "$pid" 'any(.[]; .pid == $pid and .stage == "factory" and .receipt.status == "pending" and (.allowed|not)) and any(.[]; .pid == $pid and .stage == "start:startup" and .receipt.status == "owned" and .allowed)' "$audit" >/dev/null
fi
if [[ "$scenario" == conflict ]]; then
  lab type chat 'Persist owner before admission conflict'; lab key chat Enter
  for ((i=0;i<100;i++)); do lab saved chat > "$evidence/admission-saved"; grep -q LAB_REPLY "$evidence/admission-saved" && break; sleep .1; done
  lab fresh chat contender
  contender="$(jq -r .pid "$evidence/actors/pi-contender.json")"
  for ((i=0;i<100;i++)); do lab screen contender > "$evidence/admission-conflict-screen"; grep -q 'Session already owned' "$evidence/admission-conflict-screen" && break; sleep .1; done
  grep -q 'Session already owned' "$evidence/admission-conflict-screen"
  lab key contender Escape
  for ((i=0;i<50;i++)); do lab status > "$evidence/admission-cancel-status.json"; jq -e '.conversations.contender.alive == false' "$evidence/admission-cancel-status.json" >/dev/null && break; sleep .1; done
  jq -e '.conversations.contender.alive == false and .conversations.chat.alive == true' "$evidence/admission-cancel-status.json" >/dev/null
  jq -es --argjson pid "$contender" 'any(.[]; .pid == $pid and .stage == "start:startup" and (.allowed|not)) and all(.[] | select(.pid == $pid); .allowed|not)' "$audit" >/dev/null
  jq -es --argjson pid "$contender" 'all(.[]; .pid != $pid)' "$ledger" >/dev/null
elif [[ "$scenario" == owned ]]; then
  lab type chat 'Run admission transitions'; lab key chat Enter
  for ((i=0;i<200;i++)); do [[ -f "$evidence/agent/admission-transitions.json" ]] && break; sleep .1; done
  result="$evidence/agent/admission-transitions.json"
  jq -e '.reloadValid and .sameFileValid and (.staleAllowed|not) and .current.status == "owned" and .first.generation != .current.generation and .first.sessionFile != .current.sessionFile' "$result" >/dev/null
  jq -es 'any(.[]; .stage == "shutdown:new" and .receipt.status == "stopping" and (.allowed|not)) and any(.[]; .stage == "stale-receipt" and (.allowed|not))' "$audit" >/dev/null
  newfile="$(jq -r .current.sessionFile "$result")"
  case "$newfile" in "$evidence"/*|"/private$evidence"/*) ;; *) exit 2 ;; esac
  lab type chat 'New admission session reply'; lab key chat Enter
  for ((i=0;i<100;i++)); do [[ -f "$newfile" ]] && grep -q 'LAB_REPLY New admission session reply' "$newfile" && break; sleep .1; done
  grep -q 'LAB_REPLY New admission session reply' "$newfile"
else
  lab type chat 'Ordinary admission fixture chat'; lab key chat Enter
  for ((i=0;i<100;i++)); do lab saved chat > "$evidence/admission-saved"; grep -q 'LAB_REPLY Ordinary admission fixture chat' "$evidence/admission-saved" && break; sleep .1; done
  grep -q 'LAB_REPLY Ordinary admission fixture chat' "$evidence/admission-saved"
fi
printf 'PASS actual later-loaded consumer admission scenario: %s\n' "$scenario"

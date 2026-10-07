#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/../lifecycle-lab/lab.sh"
created="$(bash "$ctl" create --extension "$here/../../agent/lifecycle/session-lifecycle.ts" --extension "$here/hang-after-settle.ts" --extension "$here/ownership-probe.ts" "$@")"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
printf '%s\n' "$created"
source "$here/runtime-common.sh" "$evidence/guard-final-status.json"
lab attach first
lab open chat
for ((i=0;i<100;i++)); do lab screen chat > "$evidence/ready-screen"; grep -q offline "$evidence/ready-screen" && break; sleep .1; done
lab type chat 'Synthetic response before root hangs'
lab key chat Enter
for ((i=0;i<100;i++)); do [[ -f "$evidence/agent/root-blocked" ]] && break; sleep .1; done
[[ -f "$evidence/agent/root-blocked" ]]
lab saved chat > "$evidence/hung-root-saved"
grep -q LAB_REPLY "$evidence/hung-root-saved"
lab status > "$evidence/hung-root-before.json"
jq -e '.conversations.chat.alive == true' "$evidence/hung-root-before.json" >/dev/null
lab detach first
start=$SECONDS
while :; do
  lab status > "$evidence/hung-root-after.json"
  jq -e '.conversations.chat.alive == false' "$evidence/hung-root-after.json" >/dev/null && break
  (( SECONDS - start < 5 )) || break
  sleep .1
done
jq -e '.conversations.chat.alive == false' "$evidence/hung-root-after.json" >/dev/null
for ((i=0;i<50;i++)); do jq -e '.status == "recovery"' "$evidence/histories/.pi-lifecycle/"*.owner.json >/dev/null && break; sleep .1; done
jq -e '.status == "recovery"' "$evidence/histories/.pi-lifecycle/"*.owner.json >/dev/null
printf 'PASS external supervisor retires TERM-resistant blocked root within five seconds and retains recovery metadata\n'
old_generation="$(jq -r .generation "$evidence/histories/.pi-lifecycle/"*.owner.json)"
lab attach replacement
lab fresh chat reopened
for ((i=0;i<100;i++)); do
  lab screen reopened > "$evidence/reopened-screen"
  grep -q offline "$evidence/reopened-screen" && break
  sleep .1
done
grep -q offline "$evidence/reopened-screen"
! grep -q 'Session already owned' "$evidence/reopened-screen"
lab type reopened 'Verified dead owner reopened automatically'
lab key reopened Enter
for ((i=0;i<100;i++)); do
  lab saved reopened > "$evidence/reopened-saved"
  grep -q 'Verified dead owner reopened automatically' "$evidence/reopened-saved" && break
  sleep .1
done
grep -q 'Verified dead owner reopened automatically' "$evidence/reopened-saved"
jq -e --arg old "$old_generation" '.status == "active" and .generation != $old' "$evidence/histories/.pi-lifecycle/"*.owner.json >/dev/null
jq -s -e 'any(.[]; .reason == "resume" and .fresh == true and .admission.status == "owned")' "$evidence/agent/ownership-starts.jsonl" >/dev/null
jq -s -e 'length == 1 and all(.[]; .reason == "resume" and .fresh == true and .admission.status == "owned")' "$evidence/agent/ownership-startup-ledger.jsonl" >/dev/null
printf 'PASS verified dead owner reopens automatically with a new generation and startup consumer admission\n'

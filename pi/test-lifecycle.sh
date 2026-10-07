#!/usr/bin/env bash
# Product deadline is 5 seconds after last relevant client detaches.
set -euo pipefail
# Before a lab exists, any failure is infrastructure, not a product observation.
trap 'rc=$?; trap - EXIT; [[ $rc == 0 ]] || exit 2' EXIT
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/tests/lifecycle-lab/lab.sh"
created="$(bash "$ctl" create "$@")"
id="$(jq -r .id <<< "$created")"
evidence="$(jq -r .evidence <<< "$created")"
printf '%s\n' "$created"
verdict=2
cleanup() {
  rc=$?; trap - EXIT
  if [[ $rc != 0 && $verdict != 1 ]]; then rc=2; fi
  bash "$ctl" cleanup "$id" || rc=2
  exit "$rc"
}
trap cleanup EXIT
lab() { bash "$ctl" "$1" "$id" "${@:2}"; }
assert() { printf '%s\n' "$*" | tee -a "$evidence/assertions.txt"; }
lab attach first
lab open chat
for ((i=0;i<100;i++)); do lab screen chat > "$evidence/ready-screen"; grep -q offline "$evidence/ready-screen" && break; sleep .1; done
lab type chat 'Synthetic greeting'
lab key chat Enter
for ((i=0;i<150;i++)); do lab saved chat > "$evidence/saved-before"; grep -q LAB_REPLY "$evidence/saved-before" && break; sleep .1; done
grep -q LAB_REPLY "$evidence/saved-before" || { assert 'FAIL baseline response not saved'; exit 2; }
lab screen chat > "$evidence/responded-screen"
grep -q LAB_REPLY "$evidence/responded-screen" || { assert 'FAIL baseline response not visible'; exit 2; }
assert 'PASS interactive fake-provider response visible and saved'
lab attach second
lab detach second
sleep 1
lab status > "$evidence/two-client-control.json"
jq -e '.conversations.chat.alive == true and .attachedClients == 1' "$evidence/two-client-control.json" >/dev/null || { assert 'FAIL two-client preservation control'; verdict=1; exit 1; }
assert 'PASS detaching one of two clients preserves Pi'
lab switch first away
sleep 1
lab switch first chat
lab status > "$evidence/switch-control.json"
jq -e '.conversations.chat.alive == true and .attachedClients == 1' "$evidence/switch-control.json" >/dev/null || { assert 'FAIL window-switch preservation control'; verdict=1; exit 1; }
assert 'PASS window switch preserves Pi'
lab detach first
start=$SECONDS
while :; do
  lab status > "$evidence/last-client.json"
  jq -e '.conversations.chat.alive == false' "$evidence/last-client.json" >/dev/null && break
  (( SECONDS - start < 5 )) || break
  sleep .1
done
assert "Observed last-client detach for $((SECONDS - start)) seconds, including final status query"
lab saved chat > "$evidence/saved-after"
grep -q LAB_REPLY "$evidence/saved-after" || { assert 'FAIL history lost'; verdict=1; exit 1; }
assert 'PASS saved history remains'
if jq -e '.conversations.chat.alive == true' "$evidence/last-client.json" >/dev/null; then
  assert 'FAIL Pi still alive after last client detached (5 second observation deadline); emergency cleanup follows'
  verdict=1; exit 1
fi
assert 'PASS Pi exited after last client detached'

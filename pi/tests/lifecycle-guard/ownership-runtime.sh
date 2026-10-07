#!/usr/bin/env bash
# Real installed CLI; only private lab roots and synthetic conversation data.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/../lifecycle-lab/lab.sh"
created="$(bash "$ctl" create --extension "$here/../../agent/lifecycle/session-lifecycle.ts" --extension "$here/ownership-probe.ts" "$@")"
id="$(jq -r .id <<< "$created")"
evidence="$(jq -r .evidence <<< "$created")"
printf '%s\n' "$created"
source "$here/runtime-common.sh" "$evidence/ownership-final-status.json"
wait_screen() {
  local name="$1" pattern="$2"
  for ((i=0;i<100;i++)); do lab screen "$name" > "$evidence/$name-screen"; grep -q "$pattern" "$evidence/$name-screen" && return; sleep .1; done
  return 1
}
lab attach first
lab open chat
wait_screen chat offline
lab type chat 'Original synthetic owner history'
lab key chat Enter
wait_screen chat LAB_REPLY
lab fresh chat contender
wait_screen contender 'Session already owned'
# Select Go to existing session. The exact client must show the owner pane
# before contender exit; the original root remains alive.
contender_pane="$(awk '{print $1}' "$evidence/open-contender-receipt")"
owner_pane="$(awk '{print $1}' "$evidence/open-chat-receipt")"
client="$(tmux -S "$evidence/tmux.sock" list-clients -F '#{client_name}')"
tmux -S "$evidence/tmux.sock" switch-client -c "$client" -t "$contender_pane"
lab key contender Down
lab key contender Enter
for ((i=0;i<100;i++)); do
  lab status > "$evidence/go-status.json"
  jq -e '.conversations.contender.alive == false' "$evidence/go-status.json" >/dev/null && break
  sleep .1
done
jq -e '.conversations.chat.alive == true and .conversations.contender.alive == false' "$evidence/go-status.json" >/dev/null
[[ "$(tmux -S "$evidence/tmux.sock" list-clients -F '#{pane_id}')" == "$owner_pane" ]]
printf 'PASS Go existing observes exact owner pane/client before contender exits\n'
lab fresh chat successor
wait_screen successor 'Session already owned'
lab type chat 'History written after contender opened'
lab key chat Enter
for ((i=0;i<100;i++)); do
  lab saved chat > "$evidence/owner-late-history"
  grep -q 'History written after contender opened' "$evidence/owner-late-history" && break
  sleep .1
done
grep -q 'History written after contender opened' "$evidence/owner-late-history"
lab key successor Enter
for ((i=0;i<100;i++)); do
  lab status > "$evidence/continue-status.json"
  jq -e '.conversations.chat.alive == false and .conversations.successor.alive == true' "$evidence/continue-status.json" >/dev/null && break
  sleep .1
done
jq -e '.conversations.chat.alive == false and .conversations.successor.alive == true' "$evidence/continue-status.json" >/dev/null
# Fresh context is checked by a test consumer on a subsequent user turn.
lab type successor 'Successor after verified retirement'
lab key successor Enter
for ((i=0;i<100;i++)); do
  lab saved successor > "$evidence/successor-saved"
  grep -q 'Successor after verified retirement' "$evidence/successor-saved" && break
  sleep .1
done
grep -q 'Successor after verified retirement' "$evidence/successor-saved"
for ((i=0;i<100;i++)); do [[ -f "$evidence/agent/ownership-probe.json" ]] && break; sleep .1; done
jq -e '.fresh == true and .admission.status == "owned"' "$evidence/agent/ownership-probe.json" >/dev/null
jq -s -e 'any(.[]; .reason == "resume" and .fresh == true and .admission.status == "owned")' "$evidence/agent/ownership-starts.jsonl" >/dev/null
jq -s -e 'length == 1 and all(.[]; .reason == "resume" and .fresh == true and .admission.status == "owned")' "$evidence/agent/ownership-startup-ledger.jsonl" >/dev/null
printf 'PASS Continue here retires old root and admits usable successor after fresh reload\n'

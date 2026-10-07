#!/usr/bin/env bash
# Only private lab resources and anonymous synthetic history are used.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/../lifecycle-lab/lab.sh"
extension="$here/../../agent/lifecycle/session-lifecycle.ts"
created="$(bash "$ctl" create --extension "$extension" --extension "$here/reload-probe.ts" "$@")"
id="$(jq -r .id <<< "$created")"
evidence="$(jq -r .evidence <<< "$created")"
printf '%s\n' "$created"
source "$here/runtime-common.sh" "$evidence/guard-final-status.json"
wait_saved() {
  for ((i=0;i<100;i++)); do lab saved chat > "$evidence/guard-saved"; grep -q "$1" "$evidence/guard-saved" && return; sleep .1; done
  return 1
}
lab attach first
lab open chat
for ((i=0;i<100;i++)); do lab screen chat > "$evidence/guard-screen"; grep -q offline "$evidence/guard-screen" && break; sleep .1; done
lab type chat 'Original owner synthetic greeting'
lab key chat Enter
wait_saved LAB_REPLY
for ((i=0;i<100;i++)); do [[ -f "$evidence/agent/reload-probe.json" ]] && break; sleep .1; done
jq -e '.before == false and .stale == false and .fresh == true and .retainedLease == true' "$evidence/agent/reload-probe.json" >/dev/null
printf 'PASS queued public command reads fresh same-file disk history and retains lease\n'
lab fresh chat contender
for ((i=0;i<100;i++)); do lab screen contender > "$evidence/contender-screen"; grep -q 'Session already owned' "$evidence/contender-screen" && break; sleep .1; done
grep -q 'Session already owned' "$evidence/contender-screen"
lab key contender Escape
for ((i=0;i<50;i++)); do lab status > "$evidence/cancel-status.json"; jq -e '.conversations.contender.alive == false' "$evidence/cancel-status.json" >/dev/null && break; sleep .1; done
jq -e '.conversations.chat.alive == true and .conversations.contender.alive == false' "$evidence/cancel-status.json" >/dev/null
lab type chat 'Owner usable after contender cancellation'
lab key chat Enter
wait_saved 'Owner usable after contender cancellation'
printf 'PASS conflict cancellation exits only contender; original owner persists work\n'
# A dead placeholder pane creates no untracked long-lived actor. The private
# server keeps dead panes, as configured by the lab controller.
tmux -S "$evidence/tmux.sock" new-session -d -s unrelated -n placeholder true
owner_pane="$(awk '{print $1}' "$evidence/open-chat-receipt")"
tmux -S "$evidence/tmux.sock" link-window -s "$owner_pane" -t unrelated:9
lab attach second
client_pid="$(jq -r .pid "$evidence/clients/second/ready.json")"
client_tty="$(tmux -S "$evidence/tmux.sock" list-clients -F '#{client_pid} #{client_tty}' | awk -v pid="$client_pid" '$1==pid {print $2}')"
[[ -n "$client_tty" ]]
tmux -S "$evidence/tmux.sock" switch-client -c "$client_tty" -t unrelated
lab detach first
sleep 1
lab status > "$evidence/linked-client-status.json"
jq -e '.conversations.chat.alive == true and .attachedClients == 1' "$evidence/linked-client-status.json" >/dev/null
printf 'PASS client in another session linked to the owner pane preserves ownership\n'
tmux -S "$evidence/tmux.sock" unlink-window -t unrelated:9
for ((i=0;i<50;i++)); do lab status > "$evidence/unrelated-client-status.json"; jq -e '.conversations.chat.alive == false' "$evidence/unrelated-client-status.json" >/dev/null && break; sleep .1; done
jq -e '.conversations.chat.alive == false and .attachedClients == 1' "$evidence/unrelated-client-status.json" >/dev/null
printf 'PASS unrelated server client does not keep owner alive after last relevant client loss\n'

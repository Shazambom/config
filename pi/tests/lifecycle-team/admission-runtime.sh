#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/../lifecycle-lab/lab.sh"
source_dir="$1"
scenario="${2:-conflict}"
case "$scenario" in conflict|owned|switch-reopen|quit|unmanaged|unprotected) ;; *) exit 2 ;; esac
extensions=()
if [[ "$scenario" != unmanaged ]]; then extensions+=(--extension "$here/../../agent/lifecycle/session-lifecycle.ts"); fi
extensions+=(--extension "$source_dir/pi-extension/subagents/team-extension.ts")
created="$(bash "$ctl" create "${extensions[@]}")"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
printf '%s\n' "$created"
cleanup() {
  rc=$?; trap - EXIT
  bash "$ctl" status "$id" > "$evidence/team-final-status.json" || rc=2
  bash "$ctl" cleanup "$id" || rc=2
  if ! bash "$ctl" status "$id" > "$evidence/team-after-cleanup-status.json" || ! jq -e 'all(.actors[]; .alive == false)' "$evidence/team-after-cleanup-status.json" >/dev/null; then rc=2; fi
  exit "$rc"
}
trap cleanup EXIT
lab() { bash "$ctl" "$1" "$id" "${@:2}"; }
if [[ "$scenario" == unprotected ]]; then printf 'synthetic failure\n' > "$evidence/histories/.pi-lifecycle"; fi
lab attach first
lab open shared
owner="$(jq -r .pid "$evidence/actors/pi-shared.json")"
# All instances use isolated HOME. teamIdentity defaults to HOME/.pi/teams/session-id.
# Discover the actual state, not a guessed UUID or the per-instance cwd.
state=''
for ((i=0;i<100;i++)); do
  state="$(find "$evidence" -path '*/.pi/teams/*/state.json' -type f -print | head -1)"
  lab screen shared > "$evidence/team-ready-screen"
  if [[ "$scenario" == unprotected ]]; then
    grep -q 'SESSION UNPROTECTED' "$evidence/team-ready-screen" && break
  elif [[ -n "$state" ]] && jq -e --argjson pid "$owner" '.members.root.pid == $pid and .members.root.live' "$state" >/dev/null; then break; fi
  sleep .1
 done
if [[ "$scenario" == unprotected ]]; then
  lab type shared 'Ordinary unprotected team root chat'; lab key shared Enter
  for ((i=0;i<100;i++)); do lab saved shared > "$evidence/team-saved"; grep -q 'LAB_REPLY Ordinary unprotected team root chat' "$evidence/team-saved" && break; sleep .1; done
  grep -q 'LAB_REPLY Ordinary unprotected team root chat' "$evidence/team-saved"
  state="$(find "$evidence" -path '*/.pi/teams/*/state.json' -type f -print | head -1)"
  if [[ -n "$state" ]]; then cp "$state" "$evidence/team-unprotected-unexpected-state.json"; echo 'FAIL unprotected startup mutated shared team state'; exit 1; fi
else
  [[ -n "$state" ]]
  jq -e --argjson pid "$owner" '.members.root.pid == $pid and .members.root.live' "$state" >/dev/null
  cp "$state" "$evidence/team-before.json"
  lab type shared 'Persist team owner before conflict'; lab key shared Enter
  for ((i=0;i<100;i++)); do lab saved shared > "$evidence/team-saved"; grep -q 'LAB_REPLY Persist team owner before conflict' "$evidence/team-saved" && break; sleep .1; done
  grep -q 'LAB_REPLY Persist team owner before conflict' "$evidence/team-saved"
  if [[ "$scenario" == conflict ]]; then
    lab fresh shared contender
    for ((i=0;i<100;i++)); do lab screen contender > "$evidence/team-conflict-screen"; grep -q 'Session already owned' "$evidence/team-conflict-screen" && break; sleep .1; done
    grep -q 'Session already owned' "$evidence/team-conflict-screen"
    lab key contender Escape
    for ((i=0;i<100;i++)); do lab status > "$evidence/team-cancel-status.json"; jq -e '.conversations.contender.alive == false' "$evidence/team-cancel-status.json" >/dev/null && break; sleep .1; done
    jq -e '.conversations.contender.alive == false and .conversations.shared.alive == true' "$evidence/team-cancel-status.json" >/dev/null
    cp "$state" "$evidence/team-after-cancel.json"
    if ! cmp "$evidence/team-before.json" "$evidence/team-after-cancel.json"; then echo 'FAIL cancelled contender changed original team registration'; exit 1; fi
  elif [[ "$scenario" == owned || "$scenario" == switch-reopen ]]; then
    lab type shared /new; lab key shared Enter
    next=''
    for ((i=0;i<100;i++)); do
      next="$(find "$evidence" -path '*/.pi/teams/*/state.json' -type f -print | grep -v -F "$state" | head -1 || true)"
      [[ -n "$next" ]] && jq -e --argjson pid "$owner" '.members.root.pid == $pid and .members.root.live' "$next" >/dev/null && break
      sleep .1
    done
    [[ -n "$next" ]]
    cp "$state" "$evidence/team-old-after-new.json"
    cp "$next" "$evidence/team-new-session.json"
    if ! jq -e --slurpfile before "$evidence/team-before.json" '. == ($before[0] | .members.root.live = false | .cancelled = ["root"])' "$evidence/team-old-after-new.json" >/dev/null; then echo 'FAIL managed switch did not retire exactly its own registration'; exit 1; fi
    jq -e --slurpfile old "$evidence/team-before.json" '.members.root.incarnation != $old[0].members.root.incarnation and .members.root.pid == $old[0].members.root.pid and .members.root.live' "$next" >/dev/null
    lab type shared 'New owned team session chat'; lab key shared Enter
    for ((i=0;i<100;i++)); do lab screen shared > "$evidence/team-new-session-screen"; grep -q 'LAB_REPLY New owned team session chat' "$evidence/team-new-session-screen" && break; sleep .1; done
    grep -q 'LAB_REPLY New owned team session chat' "$evidence/team-new-session-screen"
    if [[ "$scenario" == switch-reopen ]]; then
      cp "$next" "$evidence/team-away-before-reopen.json"
      lab fresh shared reopened
      replacement="$(jq -r .pid "$evidence/actors/pi-reopened.json")"
      for ((i=0;i<100;i++)); do
        jq -e --argjson pid "$replacement" '.members.root.pid == $pid and .members.root.live' "$state" >/dev/null && break
        sleep .1
      done
      jq -e --argjson pid "$replacement" '.members.root.pid == $pid and .members.root.live' "$state" >/dev/null
      lab status > "$evidence/team-switch-reopen-status.json"
      jq -e '.conversations.shared.alive and .conversations.reopened.alive' "$evidence/team-switch-reopen-status.json" >/dev/null
      cmp "$next" "$evidence/team-away-before-reopen.json"
      cp "$state" "$evidence/team-reopened-registration.json"
      lab type reopened 'Original session reopened while first PID stays alive'; lab key reopened Enter
      for ((i=0;i<100;i++)); do lab saved reopened > "$evidence/team-reopened-saved"; grep -q 'LAB_REPLY Original session reopened while first PID stays alive' "$evidence/team-reopened-saved" && break; sleep .1; done
      grep -q 'LAB_REPLY Original session reopened while first PID stays alive' "$evidence/team-reopened-saved"
      lab type shared /quit; lab key shared Enter
      for ((i=0;i<100;i++)); do lab status > "$evidence/team-away-quit-status.json"; jq -e '.conversations.shared.alive == false and .conversations.reopened.alive' "$evidence/team-away-quit-status.json" >/dev/null && break; sleep .1; done
      jq -e '.conversations.shared.alive == false and .conversations.reopened.alive' "$evidence/team-away-quit-status.json" >/dev/null
      cmp "$state" "$evidence/team-reopened-registration.json"
    fi
  elif [[ "$scenario" == quit ]]; then
    lab type shared /quit; lab key shared Enter
    for ((i=0;i<100;i++)); do lab status > "$evidence/team-quit-status.json"; jq -e '.conversations.shared.alive == false' "$evidence/team-quit-status.json" >/dev/null && break; sleep .1; done
    jq -e '.conversations.shared.alive == false' "$evidence/team-quit-status.json" >/dev/null
    cp "$state" "$evidence/team-after-quit.json"
    if ! jq -e --slurpfile before "$evidence/team-before.json" '. == ($before[0] | .members.root.live = false | .cancelled = ["root"])' "$evidence/team-after-quit.json" >/dev/null; then echo 'FAIL managed quit did not retire exactly its own registration'; exit 1; fi
  fi
fi
printf 'PASS actual later-loaded team admission: %s\n' "$scenario"

#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/../lifecycle-lab/lab.sh"
real_tmux=$(command -v tmux)
extension="${1:-$here/../../agent/lifecycle/session-lifecycle.ts}"
created="$(bash "$ctl" create --extension "$here/monitor-runtime-probe.ts" --extension "$extension")"
id=$(jq -r .id <<< "$created")
evidence=$(jq -r .evidence <<< "$created")
printf '%s\n' "$created"
source "$here/runtime-common.sh" "$evidence/monitor-final-status.json"
mkdir -p "$evidence/monitor-bin"
# Only the disposable Pi and its helper inherit this PATH override.
printf '#!/usr/bin/env bash\nif [[ "${3:-}" == list-panes && -f "$LIFECYCLE_LAB/monitor-outage" ]]; then exit 7; fi\nexec %q "$@"\n' "$real_tmux" > "$evidence/monitor-bin/tmux"
chmod +x "$evidence/monitor-bin/tmux"
wait_screen() {
  for ((i=0;i<100;i++)); do
    lab screen chat > "$evidence/monitor-screen"
    if grep -q "$1" "$evidence/monitor-screen"; then return; fi
    sleep .1
  done
  return 1
}
request() {
  lab type chat "$1"
  lab key chat Enter
  for ((i=0;i<100;i++)); do
    lab saved chat > "$evidence/monitor-saved"
    if grep -q "$2" "$evidence/monitor-saved"; then return; fi
    sleep .1
  done
  return 1
}
lab attach first
lab open chat
wait_screen offline
request BEFORE_OUTAGE 'LAB_REPLY BEFORE_OUTAGE'
cp "$evidence/monitor-admission.json" "$evidence/monitor-before.json"
touch "$evidence/monitor-outage"
wait_screen 'Terminal monitoring unavailable'
cp "$evidence/monitor-screen" "$evidence/monitor-warning-screen"
request DURING_OUTAGE 'LAB_REPLY DURING_OUTAGE'
cp "$evidence/monitor-admission.json" "$evidence/monitor-during.json"
rm "$evidence/monitor-outage"
for ((i=0;i<100;i++)); do
  lab screen chat > "$evidence/monitor-screen"
  if ! grep -q 'Terminal monitoring unavailable' "$evidence/monitor-screen"; then break; fi
  sleep .1
done
! grep -q 'Terminal monitoring unavailable\|SESSION UNPROTECTED' "$evidence/monitor-screen"
request AFTER_RECOVERY 'LAB_REPLY AFTER_RECOVERY'
cp "$evidence/monitor-admission.json" "$evidence/monitor-after.json"
jq -es 'all(.[]; .status=="owned") and (map(.generation)|unique|length)==1 and (map(.helperPid)|unique|length)==1 and .[0].helperPid != null' \
  "$evidence/monitor-before.json" "$evidence/monitor-during.json" "$evidence/monitor-after.json" >/dev/null
printf '%s\n' 'PASS actual CLI: temporary warning, caller tasks before/during/after outage, automatic warning clearance, same helper and ownership generation.'
lab detach first
for ((i=0;i<60;i++)); do
  lab status > "$evidence/monitor-detached.json"
  if jq -e '.conversations.chat.alive==false' "$evidence/monitor-detached.json" >/dev/null; then break; fi
  sleep .1
done
jq -e '.conversations.chat.alive==false' "$evidence/monitor-detached.json" >/dev/null
printf '%s\n' 'PASS actual CLI: confirmed terminal loss still stops the recovered private session.'

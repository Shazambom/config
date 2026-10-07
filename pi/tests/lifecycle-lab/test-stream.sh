#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
created="$(bash "$here/lab.sh" create)"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
echo "$created"
trap 'rc=$?; trap - EXIT; bash "$here/lab.sh" cleanup "$id" || rc=2; exit "$rc"' EXIT
lab() { bash "$here/lab.sh" "$1" "$id" "${@:2}"; }
wait_event() {
  local expression="$1" i
  for ((i=0;i<200;i++)); do
    jq -es "$expression" "$evidence/events.jsonl" >/dev/null && return
    sleep .1
  done
  echo "FAIL event deadline: $expression" >&2; return 1
}
lab attach first
lab open chat
for ((i=0;i<100;i++)); do lab screen chat > "$evidence/startup-screen"; grep -q offline "$evidence/startup-screen" && break; sleep .1; done
lab type chat 'slow cancellation demonstration'
lab key chat Enter
wait_event 'any(.[];.event=="stream-started")'
lab screen chat > "$evidence/streaming-screen"
grep -q LAB_STARTED "$evidence/streaming-screen"
sleep 1
jq -es 'any(.[];.event=="stream-chunk") and all(.[];.event!="stream-completed")' "$evidence/events.jsonl" >/dev/null
# Pi documents Escape as app.interrupt; Ctrl+C clears the editor.
lab key chat Escape
wait_event 'any(.[];.event=="stream-aborted")'
lab type chat 'slow completion demonstration'
lab key chat Enter
wait_event 'any(.[];.event=="stream-completed")'
for ((i=0;i<50;i++)); do lab saved chat > "$evidence/stream-saved"; grep -q LAB_DONE "$evidence/stream-saved" && break; sleep .1; done
grep -q LAB_DONE "$evidence/stream-saved"
lab screen chat > "$evidence/completed-screen"
grep -q LAB_DONE "$evidence/completed-screen"
lab type chat 'slow close during active work'
lab key chat Enter
wait_event '[.[]|select(.event=="stream-started")]|length==3'
lab close first
for ((i=0;i<30;i++)); do
  lab status > "$evidence/active-close-status.json"
  jq -e '.attachedClients==0 and (.actors|all(.[]|select(.role=="client-first" or .role=="helper-first");.alive==false))' "$evidence/active-close-status.json" >/dev/null && break
  sleep .1
done
jq -e '.attachedClients==0 and (.actors|all(.[]|select(.role=="client-first" or .role=="helper-first");.alive==false))' "$evidence/active-close-status.json" >/dev/null
echo 'PASS visible bounded stream, cancellation, completion, persistence and active-work client close observation' | tee "$evidence/stream-assertions.txt"

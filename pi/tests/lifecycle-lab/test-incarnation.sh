#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
created="$(bash "$here/lab.sh" create)"; echo "$created"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
trap 'rc=$?; trap - EXIT; if [[ -f "$evidence/first-original.json" ]]; then cp "$evidence/first-original.json" "$evidence/actors/pi-first.json"; fi; bash "$here/lab.sh" cleanup "$id" || rc=2; exit "$rc"' EXIT
lab() { bash "$here/lab.sh" "$1" "$id" "${@:2}"; }
lab attach client
lab fresh shared first
lab fresh shared second
jq -se '.[0].cwd != null and .[1].cwd != null and .[0].cwd != .[1].cwd' "$evidence/actors/pi-first.json" "$evidence/actors/pi-second.json" >/dev/null
for name in first second; do
  pid="$(jq -r .pid "$evidence/actors/pi-$name.json")"
  if [[ -e /proc/$pid/cwd ]]; then readlink "/proc/$pid/cwd" > "$evidence/$name-actual-cwd";
  else lsof -a -p "$pid" -d cwd -Fn | awk '/^n/ {print substr($0,2)}' > "$evidence/$name-actual-cwd"; fi
  expected="$(jq -r .cwd "$evidence/actors/pi-$name.json")"
  actual="$(< "$evidence/$name-actual-cwd")"
  [[ "$actual" == "$expected" || "$actual" == "/private$expected" ]]
done
cp "$evidence/actors/pi-first.json" "$evidence/first-original.json"
# Correct live second PID/start/argv, but the first incarnation's cwd receipt.
jq -s '.[0] + {pid:.[1].pid,start:.[1].start,identity:.[1].identity}' "$evidence/first-original.json" "$evidence/actors/pi-second.json" > "$evidence/actors/pi-first.json"
if lab cleanup > "$evidence/stale-cleanup.json" 2> "$evidence/stale-cleanup-error"; then echo 'FAIL stale receipt accepted'; exit 1; fi
for name in first-original actors/pi-second; do node "$here/process-presence.mjs" "$(jq -r .pid "$evidence/$name.json")"; done
jq -es 'all(.[];.event!="emergency-term" and .event!="emergency-kill")' "$evidence/events.jsonl" >/dev/null
cp "$evidence/first-original.json" "$evidence/actors/pi-first.json"
lab status > "$evidence/restored-status.json"
jq -e '.conversations.first.alive and .conversations.second.alive' "$evidence/restored-status.json" >/dev/null
echo 'PASS independent incarnation cwd; stale live receipt blocks all direct and indirect cleanup signals' | tee "$evidence/incarnation-assertions.txt"

#!/usr/bin/env bash
# Deterministically close our own client between two process observations.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
created="$(bash "$here/lab.sh" create)"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
echo "$created"
trap 'rc=$?; trap - EXIT; bash "$here/lab.sh" cleanup "$id" || rc=2; exit "$rc"' EXIT
bash "$here/lab.sh" attach "$id" first
pid="$(jq -r .pid "$evidence/actors/client-first.json")"
real_ps="$(command -v ps)"
mkdir "$evidence/race-bin"
# Retain a successful stat observation, then close through the public controller.
# The real process exits before the next lstart query, without any PID substitution.
{
  printf '#!/usr/bin/env bash\nset -euo pipefail\n'
  printf 'real_ps=%q\nctl=%q\nid=%q\npid=%q\nevidence=%q\n' "$real_ps" "$here/lab.sh" "$id" "$pid" "$evidence"
  printf '%s\n' 'if [[ "$*" == "-p $pid -o stat=" && ! -e "$evidence/race-fired" ]]; then' \
    '  "$real_ps" "$@" > "$evidence/pre-exit-stat"' \
    '  touch "$evidence/race-fired"' \
    '  bash "$ctl" close "$id" first' \
    '  for ((i=0;i<50;i++)); do "$real_ps" -p "$pid" >/dev/null || break; sleep .1; done' \
    '  while IFS= read -r line; do printf "%s\n" "$line"; done < "$evidence/pre-exit-stat"' \
    'else exec "$real_ps" "$@"; fi'
} > "$evidence/race-bin/ps"
chmod +x "$evidence/race-bin/ps"
PATH="$evidence/race-bin:$PATH" bash "$here/lab.sh" status "$id" > "$evidence/exit-race-status.json" 2> "$evidence/exit-race-error.txt"
jq -e '.actors|any(.role=="client-first" and .alive==false)' "$evidence/exit-race-status.json" >/dev/null
# A live owned provider is the sentinel: a mismatched receipt must never signal it.
cp "$evidence/actors/provider.json" "$evidence/provider-original.json"
sentinel="$(jq -r .pid "$evidence/provider-original.json")"
jq '.identity="deliberately mismatched live identity"' "$evidence/provider-original.json" > "$evidence/actors/provider.json"
if bash "$here/lab.sh" cleanup "$id" > "$evidence/mismatch-cleanup.json" 2> "$evidence/mismatch-error.txt"; then echo 'FAIL live mismatch accepted'; exit 1; fi
node "$here/process-presence.mjs" "$sentinel"
jq -es 'all(.[]; (.event!="emergency-term" and .event!="emergency-kill") or .detail!="provider.json")' "$evidence/events.jsonl" >/dev/null
cp "$evidence/provider-original.json" "$evidence/actors/provider.json"
# Failed process queries for a still-live process remain ambiguous, not exited.
printf '#!/usr/bin/env bash\nprintf "simulated query failure\\n" >&2\nexit 2\n' > "$evidence/race-bin/ps"
if PATH="$evidence/race-bin:$PATH" bash "$here/lab.sh" cleanup "$id" > "$evidence/query-cleanup.json" 2> "$evidence/query-error.txt"; then echo 'FAIL query failure treated as exit'; exit 1; fi
node "$here/process-presence.mjs" "$sentinel"
jq -es 'all(.[]; (.event!="emergency-term" and .event!="emergency-kill") or .detail!="provider.json")' "$evidence/events.jsonl" >/dev/null
echo 'PASS exit race; live mismatch and query failure fail closed without signaling sentinel' | tee "$evidence/exit-race-assertions.txt"

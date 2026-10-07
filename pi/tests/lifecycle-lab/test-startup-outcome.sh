#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
proof="$(mktemp -d "${TMPDIR:-/tmp}/lifecycle-startup.XXXXXX")"
echo "Evidence: $proof"
bash "$here/lab.sh" resolve > "$proof/delegated-cli.json"
cli="$(jq -r .cli "$proof/delegated-cli.json")"
find "$(dirname "$cli")" -type f -name '*.js' -exec shasum -a 256 {} \; > "$proof/delegated-cli-hashes.txt"
# Trusted candidate fixture delegates to the actual CLI except the named rejection.
jq -nr --arg cli "$cli" '"if(process.cwd().includes(\"/refused.\")){console.log(\"CANDIDATE_REJECTED\");process.exit(23);}\nawait import(" + ($cli|tojson) + ");"' > "$proof/candidate.mjs"
chmod +x "$proof/candidate.mjs"
created="$(bash "$here/lab.sh" create --cli "$proof/candidate.mjs")"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
echo "$created" > "$proof/lab.json"
trap 'rc=$?; trap - EXIT; bash "$here/lab.sh" cleanup "$id" || rc=2; exit "$rc"' EXIT
lab() { bash "$here/lab.sh" "$1" "$id" "${@:2}"; }
lab attach first
lab open owner
for ((i=0;i<100;i++)); do lab screen owner > "$proof/owner-screen"; grep -q offline "$proof/owner-screen" && break; sleep .1; done
lab type owner OWNER_BEFORE
lab key owner Enter
for ((i=0;i<100;i++)); do lab saved owner > "$proof/before"; grep -q LAB_REPLY "$proof/before" && break; sleep .1; done
grep -q LAB_REPLY "$proof/before"
lab fresh owner refused > "$proof/startup-result"
lab status > "$proof/status.json"
jq -e '.conversations.owner.alive and (.conversations.refused.alive|not)' "$proof/status.json" >/dev/null
lab screen refused > "$proof/rejected-screen"
grep -q 'Pane is dead (status 23' "$proof/rejected-screen"
jq -es 'all(.[];.event!="cleanup-start" and .event!="emergency-term" and .event!="emergency-kill")' "$evidence/events.jsonl" >/dev/null
# A genuine controller/window-launch failure must roll back only this attempt.
mkdir "$proof/bin"
printf '#!/usr/bin/env bash\n%q "$@"\nrc=$?\ncase " $* " in *" new-window "*) exit 23;; esac\nexit "$rc"\n' "$(command -v tmux)" > "$proof/bin/tmux"
chmod +x "$proof/bin/tmux"
if PATH="$proof/bin:$PATH" bash "$here/lab.sh" fresh "$id" owner failed > "$proof/fixture-failure.stdout" 2> "$proof/fixture-failure.stderr"; then echo 'FAIL injected window failure succeeded'; exit 1; fi
lab status > "$proof/after-fixture-failure.json"
jq -e '.conversations.owner.alive and (.conversations.failed.alive|not)' "$proof/after-fixture-failure.json" >/dev/null
lab type owner OWNER_AFTER
lab key owner Enter
for ((i=0;i<100;i++)); do lab saved owner > "$proof/after"; grep -q 'LAB_REPLY OWNER_AFTER' "$proof/after" && break; sleep .1; done
grep -q 'LAB_REPLY OWNER_AFTER' "$proof/after"
lab screen owner > "$proof/after-native-screen"
grep -q 'LAB_REPLY OWNER_AFTER' "$proof/after-native-screen"
echo 'PASS candidate startup rejection is observable and leaves first owner accepting/persisting work' | tee "$proof/assertions.txt"

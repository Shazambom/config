#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/tests/lifecycle-lab/lab.sh"
proof="$(mktemp -d "${TMPDIR:-/tmp}/lifecycle-infra.XXXXXX")"
printf 'Evidence: %s\n' "$proof"
bash "$ctl" help > "$proof/help"
bash "$ctl" resolve > "$proof/baseline.json"
jq -e '.cli|startswith("/")' "$proof/baseline.json" >/dev/null
cli="$(jq -r .cli "$proof/baseline.json")"
bash "$ctl" resolve --cli "$cli" > "$proof/candidate.json"
[[ "$(jq -r .sha256 "$proof/baseline.json")" == "$(jq -r .sha256 "$proof/candidate.json")" ]]
mkdir -p "$proof/package/bin"
ln -s "$cli" "$proof/package/bin/actual-cli"
jq -n '{bin:{pi:"bin/actual-cli"}}' > "$proof/package/package.json"
bash "$ctl" resolve --cli "$proof/package" > "$proof/package.json"
[[ "$(jq -r .cli "$proof/package.json")" == "$cli" ]]
if bash "$ctl" status ../foreign > "$proof/rejection" 2>&1; then echo 'FAIL foreign lab accepted'; exit 1; fi
if bash "$ctl" resolve --cli "$proof/missing" > "$proof/missing" 2>&1; then echo 'FAIL missing CLI accepted'; exit 1; fi
created="$(bash "$ctl" create)"
printf '%s\n' "$created" > "$proof/lab.json"
id="$(jq -r .id <<< "$created")"
trap 'bash "$ctl" cleanup "$id"' EXIT
lab() { bash "$ctl" "$1" "$id" "${@:2}"; }
lab attach first
lab status > "$proof/attached.json"
jq -e '.attachedClients == 1' "$proof/attached.json" >/dev/null
for op in 'detach ../foreign' 'screen %0' 'close /dev/tty'; do
  if lab $op >> "$proof/rejection" 2>&1; then echo "FAIL foreign resource accepted: $op"; exit 1; fi
done
lab open chat
for text in '!touch /tmp/not-allowed' '!!pwd' '/login' '/copy' '/editor' '@private-file' $'hello\033[31m'; do
  if lab type chat "$text" >> "$proof/rejection" 2>&1; then echo "FAIL unsafe input accepted"; exit 1; fi
done
lab type chat /help
lab key chat Enter
lab fresh chat other
lab status > "$proof/independent.json"
jq -e '.conversations.chat.alive and .conversations.other.alive' "$proof/independent.json" >/dev/null
if lab fresh chat other >> "$proof/rejection" 2>&1; then echo 'FAIL reused instance accepted'; exit 1; fi
lab reconnect chat
lab cleanup > "$proof/cleanup.json"
jq -e '.success == true' "$proof/cleanup.json" >/dev/null
lab status > "$proof/final.json"
jq -e '.actors | all(.alive == false)' "$proof/final.json" >/dev/null
trap - EXIT
# A failing PTY launcher must trigger bounded cleanup of its partially built lab.
created="$(bash "$ctl" create)"; id="$(jq -r .id <<< "$created")"
printf '%s\n' "$created" > "$proof/failed-attach-lab.json"
mkdir "$proof/bin"
printf '#!/usr/bin/env bash\nexit 13\n' > "$proof/bin/python3"
chmod +x "$proof/bin/python3"
if PATH="$proof/bin:$PATH" bash "$ctl" attach "$id" broken > "$proof/failed-attach.log" 2>&1; then echo 'FAIL broken attach succeeded'; exit 1; fi
lab status > "$proof/failed-attach-final.json"
jq -e '.actors | all(.alive == false)' "$proof/failed-attach-final.json" >/dev/null || { lab cleanup; echo 'FAIL partial attach leaked'; exit 1; }
# tmux can report failure after creating a pane/server. Receipts still need cleanup.
real_tmux="$(command -v tmux)"
for operation in create open; do
  mkdir "$proof/$operation-bin"
  failure=new-session; [[ $operation != open ]] || failure=new-window
  printf '#!/usr/bin/env bash\n%q "$@"\nrc=$?\ncase " $* " in *" %s "*) exit 23;; esac\nexit "$rc"\n' "$real_tmux" "$failure" > "$proof/$operation-bin/tmux"
  chmod +x "$proof/$operation-bin/tmux"
  if [[ $operation == create ]]; then
    if PATH="$proof/$operation-bin:$PATH" bash "$ctl" create > "$proof/failed-create.json" 2> "$proof/failed-create.log"; then echo 'FAIL broken create succeeded'; exit 1; fi
    # Failure diagnostics report the newly allocated evidence directory.
    failed_work="$(awk -F 'retained evidence: ' '/retained evidence:/ {split($2,a,";"); print a[1]}' "$proof/failed-create.log")"
    id="${failed_work##*/}"
  else
    created="$(PATH="$proof/$operation-bin:$PATH" bash "$ctl" create)"; id="$(jq -r .id <<< "$created")"
    lab attach first
    if PATH="$proof/$operation-bin:$PATH" bash "$ctl" open "$id" broken > "$proof/failed-open.json" 2> "$proof/failed-open.log"; then echo 'FAIL broken open succeeded'; exit 1; fi
  fi
  lab status > "$proof/failed-$operation-final.json"
  if [[ $operation == open ]]; then
    jq -e '.conversations.broken.alive==false and (.actors|any(.role=="server" and .alive))' "$proof/failed-$operation-final.json" >/dev/null || { lab cleanup; echo 'FAIL opener rollback scope'; exit 1; }
    lab cleanup > "$proof/failed-open-explicit-cleanup.json"
  else
    jq -e '.actors | all(.alive == false)' "$proof/failed-$operation-final.json" >/dev/null || { lab cleanup; echo "FAIL partial $operation leaked"; exit 1; }
  fi
done
echo 'PASS resolution, isolation, real client and bounded failure cleanup' | tee "$proof/assertions"

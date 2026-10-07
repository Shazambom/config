#!/usr/bin/env bash
# Rerun only against a completed frozen candidate. No implicit activation override.
set -euo pipefail
umask 077
work="$(cd "${1:?Proof directory required}" && pwd -P)"
source="$work/repo/pi/tests/lifecycle-deployment"
ctl="$work/repo/pi/tests/lifecycle-lab/lab.sh"
settings="$work/deployed-settings.json"
jq -e '(.extensions // []) | any(. == "./lifecycle/session-lifecycle.ts" or . == "lifecycle/session-lifecycle.ts")' "$settings" >/dev/null || {
  echo 'RED: frozen deployment lacks default activation; prepare a new candidate after activation.' >&2; exit 1;
}
cli="$(jq -r .cli "$work/cli.json")"
[[ "$(shasum -a 256 "$cli" | awk '{print $1}')" == "$(jq -r .sha256 "$work/cli.json")" ]] || { echo 'STOP: actual CLI changed; prepare again'; exit 2; }
(cd "$(dirname "$cli")"; shasum -a 256 -c "$work/cli-runtime-sha256.txt")
scenarios=(owned unprotected)
if [[ -n ${2:-} ]]; then
  case "$2" in owned|unprotected) scenarios=("$2");; *) echo 'Expected owned or unprotected' >&2; exit 2;; esac
fi
for scenario in "${scenarios[@]}"; do
  run="$work/runtime-$scenario"
  [[ ! -e "$run" ]] || { echo "STOP: retained run exists: $run; prepare again"; exit 2; }
  mkdir "$run"
  cp -R "$work/home/.pi/agent" "$run/agent"
  cp "$source/adapter.mjs" "$run/adapter.mjs"; chmod +x "$run/adapter.mjs"
  agent="$run/agent"
  # A public admission-bus witness loaded after the unchanged guard setting and
  # before package consumers. The actual team package remains a deployed default.
  cp "$work/repo/pi/tests/lifecycle-guard/admission-consumer.ts" "$agent/lifecycle/deployment-witness.ts"
  jq '.extensions += ["./lifecycle/deployment-witness.ts"]' "$agent/settings.json" > "$run/settings.json"
  cp "$run/settings.json" "$agent/settings.json"
  jq -n --arg cli "$cli" --arg agent "$agent" '{cli:$cli,agent:$agent}' > "$run/config.json"
  created="$(bash "$ctl" create --cli "$run/adapter.mjs")"
  printf '%s\n' "$created" > "$run/lab.json"
  id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
  cleanup() {
    rc=$?; trap - EXIT
    bash "$ctl" cleanup "$id" > "$run/cleanup.json" || rc=2
    bash "$ctl" status "$id" > "$run/after-cleanup.json" || rc=2
    jq -e 'all(.actors[]; .alive == false)' "$run/after-cleanup.json" >/dev/null || rc=2
    exit "$rc"
  }
  trap cleanup EXIT
  lab() { bash "$ctl" "$1" "$id" "${@:2}"; }
  if [[ "$scenario" == unprotected ]]; then printf 'synthetic failure\n' > "$evidence/histories/.pi-lifecycle"; fi
  lab attach first > "$run/attach.json"
  lab open shared > "$run/open.json"
  owner="$(jq -r .pid "$evidence/actors/pi-shared.json")"
  # Bounded observation of this test's own runtime, not worker polling.
  for ((i=0;i<100;i++)); do
    lab screen shared > "$run/screen.txt"
    if [[ "$scenario" == unprotected ]]; then
      if grep -q 'SESSION UNPROTECTED' "$run/screen.txt" && [[ -f "$agent/admission-audit.jsonl" ]] && jq -es 'any((.stage | startswith("start:")) and .receipt.status == "unprotected")' "$agent/admission-audit.jsonl" >/dev/null; then break; fi
    elif [[ -f "$agent/admission-audit.jsonl" ]] && jq -es 'any((.stage | startswith("start:")) and .receipt.status == "owned")' "$agent/admission-audit.jsonl" >/dev/null; then break; fi
    sleep .1
  done
  if [[ "$scenario" == unprotected ]]; then
    grep -q 'SESSION UNPROTECTED' "$run/screen.txt"
    jq -es 'any(.stage | startswith("start:")) and all(.[] | select(.stage | startswith("start:")); .receipt.status == "unprotected" and .allowed == false)' "$agent/admission-audit.jsonl" >/dev/null
  else
    jq -es 'any(.stage == "factory" and .receipt.status == "pending" and .allowed == false) and any((.stage | startswith("start:")) and .receipt.status == "owned" and .allowed == true)' "$agent/admission-audit.jsonl" >/dev/null
  fi
  lab type shared "Deployment $scenario ordinary chat"; lab key shared Enter
  for ((i=0;i<100;i++)); do
    lab saved shared > "$run/saved.txt"
    grep -q "LAB_REPLY Deployment $scenario ordinary chat" "$run/saved.txt" && break
    sleep .1
  done
  grep -q "LAB_REPLY Deployment $scenario ordinary chat" "$run/saved.txt"
  if [[ "$scenario" == owned ]]; then
    lab key shared C-r
    scope_selected=false; research_selected=false
    for ((i=0;i<80;i++)); do
      lab screen shared > "$run/picker-screen.txt"
      if grep -q '> \[ \] scope-creep' "$run/picker-screen.txt"; then
        lab type shared ' '; scope_selected=true
      elif grep -q '> \[ \] research-escape-hatch' "$run/picker-screen.txt"; then
        lab type shared ' '; research_selected=true
      fi
      if [[ "$scope_selected" == true && "$research_selected" == true ]]; then break; fi
      lab key shared Down; sleep .1
    done
    [[ "$scope_selected" == true && "$research_selected" == true ]]
    lab screen shared > "$run/picker-selected.txt"
    lab key shared Enter
    lab type shared DEPLOYMENT_SNIPPETS; lab key shared Enter
    {
      printf 'DEPLOYMENT_SNIPPETS\n\n'
      awk '/^---$/ { header++; next } header >= 2 { print }' "$agent/extensions/prompt-snippets/snippets/scope-creep.md"
      printf '\n'
      awk '/^---$/ { header++; next } header >= 2 { print }' "$agent/extensions/prompt-snippets/snippets/research-escape-hatch.md"
    } > "$run/expected-snippet-input.txt"
    for ((i=0;i<100;i++)); do
      lab saved shared > "$run/snippet-saved.txt"
      grep -q 'LAB_REPLY DEPLOYMENT_SNIPPETS' "$run/snippet-saved.txt" && break
      sleep .1
    done
    grep -q 'LAB_REPLY DEPLOYMENT_SNIPPETS' "$run/snippet-saved.txt"
    jq -es --rawfile expected "$run/expected-snippet-input.txt" '[.[] | select(.event == "request") | .body.messages[] | select(.role == "user") | .content | if type == "string" then . else map(select(.type == "text") | .text) | join("\n") end] | index($expected | rtrimstr("\n")) != null' "$evidence/events.jsonl" >/dev/null
    printf 'PASS: actual CLI Ctrl+R picker, both deployed snippets, exact transformed provider input\n'
  fi
  find "$evidence" -path '*/.pi/teams/*/state.json' -type f -print > "$run/team-files.txt"
  if [[ "$scenario" == unprotected ]]; then
    [[ ! -s "$run/team-files.txt" ]] || { echo 'FAIL: unprotected runtime initialized team'; exit 1; }
  else
    [[ -s "$run/team-files.txt" ]] || { echo 'FAIL: default team did not initialize'; exit 1; }
    state="$(head -1 "$run/team-files.txt")"
    jq -e --argjson pid "$owner" '.members.root.pid == $pid and .members.root.live' "$state" >/dev/null
    cp "$state" "$run/team-state.json"
  fi
  lab status > "$run/live-status.json"
  jq -e '.conversations.shared.alive == true' "$run/live-status.json" >/dev/null
  lab cleanup > "$run/cleanup.json"
  lab status > "$run/after-cleanup.json"
  jq -e 'all(.actors[]; .alive == false)' "$run/after-cleanup.json" >/dev/null
  trap - EXIT
  printf 'PASS: deployed default %s, ordinary chat, actual team registration check\n' "$scenario"
done

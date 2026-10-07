#!/usr/bin/env bash
# Product ownership regression. A waiting/refused second opener is not a writer.
set -euo pipefail
trap 'rc=$?; trap - EXIT; [[ $rc == 0 ]] || exit 2' EXIT
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ctl="$here/tests/lifecycle-lab/lab.sh"
created="$(bash "$ctl" create "$@")"; echo "$created"
id="$(jq -r .id <<< "$created")"; evidence="$(jq -r .evidence <<< "$created")"
verdict=2
trap 'rc=$?; trap - EXIT; if [[ $rc != 0 && $verdict != 1 ]]; then rc=2; fi; bash "$ctl" cleanup "$id" || rc=2; exit "$rc"' EXIT
lab() { bash "$ctl" "$1" "$id" "${@:2}"; }
note() { printf '%s\n' "$*" | tee -a "$evidence/ownership-assertions.txt"; }
inconclusive() { note "INCONCLUSIVE: $*"; exit 2; }
request_count() { jq -s '[.[]|select(.event=="request")]|length' "$evidence/events.jsonl"; }
conversation_hash() {
  # User-approved extension boundary: native startup metadata may precede the
  # ownership check. Conversation/system entries must still remain unchanged.
  jq -csS '[.[] | select(.type != "session_info" and .type != "model_change" and .type != "thinking_level_change")]' "$1" |
    shasum -a 256 | awk '{print $1}'
}
request_seen() {
  jq -es --arg marker "$1" 'any(.[]; .event=="request" and (.body.messages|map(select(.role=="user"))|last|tostring|contains($marker)))' "$evidence/events.jsonl" >/dev/null
}
response_saved() {
  lab saved "$1" > "$evidence/observed-$1-saved"
  grep -q "LAB_REPLY $2" "$evidence/observed-$1-saved"
}
wait_reply() {
  local name="$1" marker="$2" deadline=$((SECONDS+15))
  while (( SECONDS < deadline )); do
    if request_seen "$marker" && response_saved "$name" "$marker"; then return; fi
    sleep .1
  done
  return 1
}
normal_editor() {
  # Positive native UI observation: our literal draft is between the two full
  # editor borders, with the selected model in the footer. No modal consent.
  local name="$1" marker="$2"
  lab type "$name" "$marker"
  lab screen "$name" > "$evidence/editor-$name.txt"
  grep -q offline "$evidence/editor-$name.txt" || return 1
  awk -v marker="$marker" '/^─+$/ {borders++; next} index($0,marker) && borders==1 {draft=1} END {exit !(borders==2 && draft)}' "$evidence/editor-$name.txt"
}
protected_prompt() {
  grep -Ei '(ownership|already.*(open|owned)|another.*(instance|process))' "$1" >/dev/null &&
    grep -Ei '(take.?over|cancel|wait|read.only|locked|refus|reject)' "$1" >/dev/null
}
lab attach first
lab open shared
# Wait for the known normal editor frame before placing the first literal draft.
deadline=$((SECONDS+15))
while (( SECONDS < deadline )); do lab screen shared > "$evidence/owner-startup.txt"; grep -q offline "$evidence/owner-startup.txt" && break; sleep .1; done
normal_editor shared OWNER_SEED || inconclusive 'first normal editor not positively identified'
lab key shared Enter
wait_reply shared OWNER_SEED || inconclusive 'first owner did not demonstrate saved provider response'
lab screen shared > "$evidence/owner-seeded.txt"
grep -q 'LAB_REPLY OWNER_SEED' "$evidence/owner-seeded.txt" || inconclusive 'first response not visible'
# First owner is idle. Establish unchanged conversation content before opening.
sleep .3
cp "$evidence/histories/shared.jsonl" "$evidence/pre-open.jsonl"
before_hash="$(conversation_hash "$evidence/histories/shared.jsonl")"
sleep .3
[[ "$(conversation_hash "$evidence/histories/shared.jsonl")" == "$before_hash" ]] || inconclusive 'first owner conversation was not idle'
before_requests="$(request_count)"
printf '%s\n' "$before_hash" > "$evidence/pre-open-content.sha256"
lab fresh shared contender
# Five seconds without any user input to the second opener. Observe every sample.
deadline=$((SECONDS+5)); sample=0
while :; do
  sample=$((sample+1))
  lab screen contender > "$evidence/second-preconsent-$sample.txt"
  lab status > "$evidence/second-preconsent-$sample.json"
  hash="$(conversation_hash "$evidence/histories/shared.jsonl")"
  jq -nc --arg hash "$hash" --argjson requests "$(request_count)" '{time:now,conversationHash:$hash,requests:$requests}' >> "$evidence/preconsent-observations.jsonl"
  (( SECONDS < deadline )) || break
  sleep .1
done
cp "$evidence/histories/shared.jsonl" "$evidence/post-open.jsonl"
cp "$evidence/second-preconsent-$sample.txt" "$evidence/second-decision-screen.txt"
cp "$evidence/second-preconsent-$sample.json" "$evidence/second-decision-state.json"
result=0
if ! jq -es --arg hash "$before_hash" --argjson count "$before_requests" 'all(.[];.conversationHash==$hash and .requests==$count)' "$evidence/preconsent-observations.jsonl" >/dev/null; then
  note 'FAIL second opening changed conversation content or issued a request before consent while first was idle'
  result=1
fi
second_mode=unknown
if jq -e '.conversations.contender.alive==false' "$evidence/second-decision-state.json" >/dev/null; then
  second_mode=exited
elif protected_prompt "$evidence/second-decision-screen.txt"; then
  second_mode=prompt
  note 'Observed explicit ownership prompt; did not send consent or Enter'
else
  # Only submit if literal typing is visibly handled by the normal chat editor.
  if normal_editor contender CONTENDER_WORK; then
    second_mode=editor
    lab key contender Enter
    if wait_reply contender CONTENDER_WORK; then
      lab screen contender > "$evidence/contender-accepted-screen.txt"
      note 'FAIL second instance accepted model work and persisted its reply while first owner remained attached'
      result=1
    else
      lab screen contender > "$evidence/contender-after-probe.txt"
      if protected_prompt "$evidence/contender-after-probe.txt" && ! request_seen CONTENDER_WORK; then second_mode=prompt;
      else inconclusive 'ordinary-chat probe had no attributable protected or accepted outcome'; fi
    fi
  else inconclusive 'second screen is neither explicit refusal/exit, ownership prompt nor positively identified normal editor'; fi
fi
# Separate the first-owner usability phase from the pre-consent write observation.
cp "$evidence/histories/shared.jsonl" "$evidence/before-owner-continuation.jsonl"
lab status > "$evidence/before-owner-continuation-status.json"
jq -e '.attachedClients>=1 and .conversations.shared.alive' "$evidence/before-owner-continuation-status.json" >/dev/null || { note 'FAIL legitimate first owner no longer alive and attached'; verdict=1; exit 1; }
lab reconnect shared
normal_editor shared OWNER_CONTINUES || inconclusive 'first owner editor unavailable for continued-work check'
lab key shared Enter
if wait_reply shared OWNER_CONTINUES; then note 'PASS first attached owner still accepts and persists work';
else note 'FAIL first owner could not complete continued work'; result=1; fi
cp "$evidence/histories/shared.jsonl" "$evidence/raw-final.jsonl"
jq -s '[.[]|select(.type=="message")|{id,parentId,role:.message.role,text:[.message.content[]?|select(.type=="text")|.text]}]' "$evidence/raw-final.jsonl" > "$evidence/raw-entry-order.json"
jq -s '[.[]|select(.event=="request" or .event=="response") ]' "$evidence/events.jsonl" > "$evidence/provider-receipts.json"
# When overlapping work is demonstrated, inspect restoration through a real CLI.
# Raw file entry order alone does not prove the active branch/context is intact.
if [[ $second_mode == editor ]] && request_seen CONTENDER_WORK; then
  lab key contender C-d
  lab key shared C-d
  deadline=$((SECONDS+10))
  while :; do
    lab status > "$evidence/pre-resume-status.json"
    jq -e '.conversations.shared.alive==false and .conversations.contender.alive==false' "$evidence/pre-resume-status.json" >/dev/null && break
    (( SECONDS < deadline )) || break
    sleep .1
  done
  if jq -e '.conversations.shared.alive==false and .conversations.contender.alive==false' "$evidence/pre-resume-status.json" >/dev/null; then
    lab fresh shared restored
    deadline=$((SECONDS+15))
    while (( SECONDS < deadline )); do lab screen restored > "$evidence/restored-native-screen.txt"; grep -q offline "$evidence/restored-native-screen.txt" && break; sleep .1; done
    if normal_editor restored RESUME_CONTEXT; then
      lab key restored Enter
      if wait_reply restored RESUME_CONTEXT; then
        jq -s '[.[]|select(.event=="request" and (.body.messages|map(select(.role=="user"))|last|tostring|contains("RESUME_CONTEXT")))]|last|.body.messages' "$evidence/events.jsonl" > "$evidence/restored-model-context.json"
        jq '{ownerSeed:(tostring|contains("OWNER_SEED")),contenderWork:(tostring|contains("CONTENDER_WORK")),ownerContinues:(tostring|contains("OWNER_CONTINUES"))}' "$evidence/restored-model-context.json" > "$evidence/restored-context-markers.json"
        note "Actual restored model context markers: $(jq -c . "$evidence/restored-context-markers.json")"
      else note 'INCONCLUSIVE resume-context observation: no completed probe'; fi
    else note 'INCONCLUSIVE resume-context observation: editor not identified'; fi
  else note 'INCONCLUSIVE resume-context observation: original instances did not quit'; fi
fi
if [[ $result == 0 ]]; then
  [[ $second_mode == prompt || $second_mode == exited ]] || inconclusive 'second protection was not established'
  note 'PASS second opening remains protected without consent; conversation content/request counts unchanged and first owner usable (startup metadata allowed)'
fi
verdict="$result"
exit "$result"

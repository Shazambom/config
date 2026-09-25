#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v tmux >/dev/null
command -v jq >/dev/null
source "$repo/pi/command-path.sh"
cli="${PI_PATH_CLI:-$(pi_real_command "$repo/pi/node_modules/.bin/pi")}"
if [[ ! -f "$cli" || ! -r "$cli" ]]; then
  printf 'Pi CLI is missing or unreadable: %s\n' "$cli" >&2
  exit 1
fi
# run.sh changes cwd; preserve the caller's meaning for relative overrides.
cli="$(cd -- "$(dirname -- "$cli")" && pwd)/$(basename -- "$cli")"
umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-path-proof.XXXXXX")"
socket="$work/tmux.sock"
trap 'tmux -S "$socket" kill-server 2>/dev/null || true; printf "Path proof artifacts: %s\n" "$work"' EXIT
mkdir -p "$work/home/.pi/agent" "$work/cwd/claude/skills/why/references" "$work/home/fixture"
printf 'Bounded repository fixture.\n' > "$work/cwd/claude/skills/why/references/epistemics.md"
printf 'Bounded home fixture.\n' > "$work/home/fixture/epistemics.md"
mkdir -p "$work/cwd/space dir" "$work/home/space dir"
printf 'Quoted fixture.\n' > "$work/cwd/space dir/epistemics note.md"
printf 'Quoted home fixture.\n' > "$work/home/space dir/epistemics note.md"
printf 'Second selection.\n' > "$work/home/fixture/zebra.md"
printf 'Stable selected identity.\n' > "$work/home/fixture/epistemology.md"
# Delay the real fd process only for the explicit in-flight request check below.
# Its actual output still comes from the bounded fixture directories.
fd="$(command -v fd || command -v fdfind)"
mkdir -p "$work/home/.pi/agent/bin"
printf '#!/bin/bash\nif [[ -f %q ]]; then sleep 0.5; elif [[ -f %q ]]; then sleep 0.2; fi\nexec %q "$@"\n' "$work/focus-delay-fd" "$work/delay-fd" "$fd" > "$work/home/.pi/agent/bin/fd"
chmod +x "$work/home/.pi/agent/bin/fd"
vimref="$(jq -r '.[]|select(.name=="pi-vimmode")|.ref' "$repo/pi/upstream.json")"
jq -n --arg vim "$repo/pi/upstream/pi-vimmode-$vimref" '{packages:[$vim],defaultProvider:"path-proof",defaultModel:"echo",defaultThinkingLevel:"off",compaction:{enabled:false},defaultProjectTrust:"no"}' > "$work/home/.pi/agent/settings.json"
printf 'globalThis.fetch = async () => { throw new Error("Network blocked"); };\n' > "$work/offline.mjs"
printf '#!/bin/bash\ncd %q\nexec env -i HOME=%q PATH=%q TERM=xterm-256color PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_PATH_PROOF=%q PI_PATH_FAULT=%q %q --import %q %q --no-session --no-tools -e %q\n' "$work/cwd" "$work/home" "$PATH" "$work/home/.pi/agent" "$work/events.jsonl" "$work/query-fault" "$(command -v node)" "$work/offline.mjs" "$cli" "$repo/pi/tests/path-completion-probe.mjs" > "$work/run.sh"
tmux -S "$socket" -f /dev/null new-session -d -s proof -x 110 -y 40 "bash '$work/run.sh'"
wait_event() {
  local i
  for ((i=0;i<100;i++)); do
    if [[ -f "$work/events.jsonl" ]] && jq -es "$1" "$work/events.jsonl" >/dev/null; then return; fi
    sleep 0.1
  done
  tmux -S "$socket" capture-pane -p -e > "$work/failure.ansi"
  echo "Timeout: $1" >&2; exit 1
}
key() { tmux -S "$socket" send-keys -t proof "$@"; sleep 0.15; }
text() { tmux -S "$socket" send-keys -t proof -l "$1"; sleep 0.4; }
draft() {
  local count
  count="$(jq -s '[.[]|select(.type=="draft")]|length' "$work/events.jsonl")"
  key F6
  wait_event "[.[]|select(.type==\"draft\")]|length > $count"
  jq -es --arg expected "$1" '[.[]|select(.type=="draft")][-1].text==$expected' "$work/events.jsonl" >/dev/null || { echo "Wrong draft: $1" >&2; exit 1; }
}
submit() {
  local expected="$1"
  jq -es --argjson n "$submitted" '([.[]|select(.type=="input")]|length==$n) and ([.[]|select(.type=="model")]|length==$n)' "$work/events.jsonl" >/dev/null
  key Enter
  submitted=$((submitted+1))
  wait_event "[.[]|select(.type==\"end\")]|length == $submitted"
  jq -es --arg expected "$expected" '[.[]|select(.type=="model")][-1].messages|[.[]|select(.role=="user")][-1].content==[{type:"text",text:$expected}]' "$work/events.jsonl" >/dev/null
}
wait_event 'any(.[];.type=="start")'
sleep 1
submitted=0
commands=0
for mode in off on; do
  if [[ "$mode" == off ]]; then key F7; else key F8; fi
  for accept in Enter Tab; do
    for prefix in '@./claude/skills/why/references/epi' '@~/fixture/epi'; do
      text "${prefix%epi}"
      text e; text p; text i
      tmux -S "$socket" capture-pane -p -e > "$work/$mode-$accept-$submitted-menu.ansi"
      key "$accept"
      expected="${prefix%epi}epistemics.md "
      draft "$expected"
      submit "${expected% }"
    done
    # The path is inserted at a real mid-line cursor, leaving its suffix intact.
    text 'lead  suffix'
    key C-a
    for ((column=0;column<5;column++)); do key Right; done
    text '@~/fixture/epi'
    key "$accept"
    draft 'lead @~/fixture/epistemics.md  suffix'
    text X
    draft 'lead @~/fixture/epistemics.md X suffix'
    submit 'lead @~/fixture/epistemics.md X suffix'
    for base in './' '~/'; do
      text "@\"${base}space dir/epi"
      key "$accept"
      expected="@\"${base}space dir/epistemics note.md\" "
      draft "$expected"
      submit "${expected% }"
    done
    text '@~/fixture/'
    expected="$(jq -r -s '[.[]|select(.type=="suggestions" and .prefix=="@~/fixture/")][-1].items[1].value' "$work/events.jsonl")"
    key Down
    key "$accept"
    draft "$expected "
    submit "$expected"
  done
  # Ordinary typing after completion still reaches the same editor.
  text 'ordinary typing'
  draft 'ordinary typing'
  submit 'ordinary typing'
 done
# One physical accept must complete after refresh. Repeated pending accepts
# coalesce, and neither case may submit until the separate submit() below.
for mode in off on; do
  if [[ "$mode" == off ]]; then key F7; else key F8; fi
  for accept in Enter Tab; do
    for suffix in '' ' suffix'; do
      if [[ -n "$suffix" ]]; then text "$suffix"; key C-a; fi
      text '@~/fixture/epi'
      before="$(jq -s '[.[]|select(.type=="completion")]|length' "$work/events.jsonl")"
      if [[ -z "$suffix" ]]; then
        tmux -S "$socket" send-keys -t proof -l s \; send-keys -t proof "$accept"
      else
        tmux -S "$socket" send-keys -t proof -l s \; send-keys -t proof "$accept" "$accept"
      fi
      wait_event "[.[]|select(.type==\"completion\")]|length == $((before+1))"
      draft "@~/fixture/epistemics.md $suffix"
      tmux -S "$socket" capture-pane -p -e > "$work/$mode-$accept-$submitted-deferred.ansi"
      expected="@~/fixture/epistemics.md $suffix"
      submit "${expected% }"
    done
    # The arrow-selected second candidate must survive a fresh ranking.
    text '@~/fixture/e'
    key Down
    before="$(jq -s '[.[]|select(.type=="completion")]|length' "$work/events.jsonl")"
    tmux -S "$socket" send-keys -t proof -l p \; send-keys -t proof "$accept"
    wait_event "[.[]|select(.type==\"completion\")]|length == $((before+1))"
    draft '@~/fixture/epistemology.md '
    submit '@~/fixture/epistemology.md'
    # A quoted home path while a real fd query is already running.
    text '@"~/space dir/epi'
    before="$(jq -s '[.[]|select(.type=="completion")]|length' "$work/events.jsonl")"
    : > "$work/delay-fd"
    tmux -S "$socket" send-keys -t proof -l s
    sleep 0.08
    tmux -S "$socket" send-keys -t proof "$accept"
    draft '@"~/space dir/epis'
    wait_event "[.[]|select(.type==\"completion\")]|length == $((before+1))"
    rm "$work/delay-fd"
    draft '@"~/space dir/epistemics note.md" '
    submit '@"~/space dir/epistemics note.md"'
  done
  # Fresh slash completion still dispatches on the first Enter.
  text '/path-proof-com'
  key Enter
  wait_event "[.[]|select(.type==\"command\")]|length == $((commands+1))"
  commands=$((commands+1))
  draft ''
  # Deferred slash Enter retains ordinary command-dispatch behavior, exactly once.
  text '/path-proof-c'
  tmux -S "$socket" send-keys -t proof -l o \; send-keys -t proof Enter Enter
  commands=$((commands+1))
  wait_event "[.[]|select(.type==\"command\")]|length == $commands"
  draft ''
done
# Pending acceptance is canceled by further input or editor/session changes.
# Negative cases never send a follow-up accept to disguise a late application.
for mode in off on; do
  if [[ "$mode" == off ]]; then key F7; else key F8; fi
  for action in type edit move escape replace no-match missing reject obsolete focus session; do
    text '@~/fixture/epi'
    if [[ "$action" == missing ]]; then key Down; fi
    before="$(jq -s '[.[]|select(.type=="completion")]|length' "$work/events.jsonl")"
    : > "$work/delay-fd"
    if [[ "$action" == focus ]]; then : > "$work/focus-delay-fd"; fi
    if [[ "$action" == reject ]]; then printf reject > "$work/query-fault"; fi
    if [[ "$action" == obsolete ]]; then printf ignore-abort > "$work/query-fault"; fi
    extra=s
    [[ "$action" != no-match ]] || extra=zzzz
    tmux -S "$socket" send-keys -t proof -l "$extra" \; send-keys -t proof Enter
    sleep 0.08
    expected="@~/fixture/epi$extra"
    case "$action" in
      type) tmux -S "$socket" send-keys -t proof -l x; expected="${expected}x" ;;
      edit) tmux -S "$socket" send-keys -t proof -l x \; send-keys -t proof BSpace ;;
      move|obsolete) tmux -S "$socket" send-keys -t proof Left Right ;;
      escape) key Escape ;;
      replace) key F5; expected='replacement draft' ;;
      missing) rm "$work/home/fixture/epistemology.md" ;;
      focus)
        key C-l
        tmux -S "$socket" capture-pane -p -e > "$work/$mode-model-selector.ansi"
        grep -q 'to set as default' "$work/$mode-model-selector.ansi"
        key Escape
        draft "$expected"
        tmux -S "$socket" capture-pane -p -e > "$work/$mode-model-return.ansi"
        ! grep -q 'to set as default' "$work/$mode-model-return.ansi"
        ;;
      session) key F10 ;;
    esac
    sleep 1.2
    rm -f "$work/delay-fd" "$work/focus-delay-fd" "$work/query-fault"
    draft "$expected"
    jq -es --argjson n "$before" '[.[]|select(.type=="completion")]|length==$n' "$work/events.jsonl" >/dev/null
    jq -es --argjson n "$submitted" '([.[]|select(.type=="input")]|length==$n) and ([.[]|select(.type=="model")]|length==$n)' "$work/events.jsonl" >/dev/null
    printf 'Stable selected identity.\n' > "$work/home/fixture/epistemology.md"
    key C-a; key C-k
    draft ''
  done
done
jq -es 'any(.[]; .type=="query-error") and any(.[]; .type=="suggestions" and .aborted==true and (.items|length)>0)' "$work/events.jsonl" >/dev/null
# A rejected/obsolete query must not poison subsequent completion requests.
# Entering insert mode from Vim normal mode still supports home-path completion.
key Escape
text i
text '@~/fixture/epi'
key Enter
draft '@~/fixture/epistemics.md '
submit '@~/fixture/epistemics.md'
jq -es 'any(.[]; .type=="key" and .data=="\r" and .pending>0)' "$work/events.jsonl" >/dev/null
printf 'PASS: single-accept TUI completion, coalescing, cancellation including focus round-trip, query failures, identity, suffixes, quotes, slash dispatch, offline receipts\n'

#!/usr/bin/env bash
set -euo pipefail
umask 077
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$repo/pi/launch-args.sh"
source "$repo/pi/command-path.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-launch-args.XXXXXX")"
printf 'Launch argument evidence: %s\n' "$work"
check_unchanged() {
  printf '%s\0' "$@" > "$work/expected"
  pi_prepare_launch_args "$@"
  printf '%s\0' "${pi_launch_args[@]}" > "$work/actual"
  cmp "$work/expected" "$work/actual"
}
check_unchanged --mode rpc --t3 --team --no-session --offline
check_unchanged --mode rpc --t3 --team --no-extensions --no-tools --fork 'file with spaces'
check_unchanged --mode rpc --t3 --team --offline --no-extensions --no-tools --fork file --extension custom.ts
check_unchanged --mode rpc --t3 --team=invalid --offline --no-extensions --no-tools --fork file
check_unchanged --mode rpc --team invalid --offline --no-extensions --no-tools --fork file
check_unchanged -p -- --t3
check_unchanged --system-prompt --t3 -p task
[[ "$pi_launch_t3" == false ]]
check_unchanged --t3=false -p task
[[ "$pi_launch_t3" == false ]]
if pi_prepare_launch_args --t3 -p task 2> "$work/non-rpc.stderr"; then
  echo 'FAIL: --t3 accepted outside RPC' >&2; exit 1
fi
pi_prepare_launch_args --mode rpc --team false --t3=true --offline -ne -nt --fork file
printf '%s\0' --mode rpc --offline -ne -nt --fork file > "$work/expected"
printf '%s\0' "${pi_launch_args[@]}" > "$work/actual"
cmp "$work/expected" "$work/actual"
# No adapter flags is also a valid metadata helper invocation.
check_unchanged --mode rpc --offline --no-extensions --no-tools --fork file

# Exercise Pi's actual fork path with the normalized argv, no model/credentials.
cli="$(pi_real_command "$(command -v pi)")"
node="$(command -v node)"
mkdir -p "$work/home" "$work/agent" "$work/cwd"
jq -cn --arg cwd "$work/cwd" --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{type:"session",version:3,id:"00000000-0000-4000-8000-000000000001",timestamp:$timestamp,cwd:$cwd},
   {type:"message",id:"11111111",parentId:null,timestamp:$timestamp,message:{role:"user",content:[{type:"text",text:"Synthetic fork source"}],timestamp:0}}' > "$work/source.jsonl"
cp "$work/source.jsonl" "$work/source-before.jsonl"
pi_prepare_launch_args --mode rpc --team --t3 --offline --no-extensions --no-tools --fork "$work/source.jsonl"
mkfifo "$work/input" "$work/output"
pid=''
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
(
  cd "$work/cwd"
  exec env -i HOME="$work/home" PATH="$(dirname "$node"):/usr/bin:/bin" \
    PI_CODING_AGENT_DIR="$work/agent" PI_OFFLINE=1 \
    "$cli" "${pi_launch_args[@]}" < "$work/input" > "$work/output" 2> "$work/cli.stderr"
) &
pid=$!
exec 3> "$work/input"
exec 4< "$work/output"
printf '%s\n' '{"id":"fork-state","type":"get_state"}' >&3
IFS= read -r -t 30 reply <&4
printf '%s\n' "$reply" > "$work/state.json"
jq -e --arg original "$work/source.jsonl" '.id == "fork-state" and .success == true and (.data.sessionFile | type == "string") and .data.sessionFile != $original' "$work/state.json" >/dev/null
forked="$(jq -er '.data.sessionFile' "$work/state.json")"
[[ -f "$forked" ]]
jq -se 'any(.[]; .type == "message" and any(.message.content[]?; .text == "Synthetic fork source"))' "$forked" >/dev/null
cmp "$work/source-before.jsonl" "$work/source.jsonl"
exec 3>&-
# Match RPC hosts that terminate their short-lived helper after get_state. The
# unpatched CLI can retain its RPC loop after stdin EOF.
kill -TERM "$pid" 2>/dev/null || true
exit_status=0
wait "$pid" || exit_status=$?
[[ "$exit_status" == 0 || "$exit_status" == 143 ]]
pid=''
exec 4<&-
printf '%s\n' 'PASS: argv boundaries, opt-in refusal, discovery, and actual offline RPC fork with unchanged source.'

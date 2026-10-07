#!/usr/bin/env bash
# Team boundary: old root stays alive after new/fork shutdown; another PID reopens.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_dir="$1"
artifacts="$2"
mkdir -p "$artifacts"
pids=(); roles=()
cleanup() {
  local rc=$? pid role
  for role in ${roles[@]+"${roles[@]}"}; do : > "$role.exit"; done
  for pid in ${pids[@]+"${pids[@]}"}; do wait "$pid" || rc=2; done
  printf '{"allChildrenReaped":true,"exit":%s}\n' "$rc" > "$artifacts/cleanup.json"
  exit "$rc"
}
trap cleanup EXIT
await_file() {
  local path="$1" i
  for ((i=0;i<200;i++)); do [[ -f "$path" ]] && return; sleep .02; done
  printf 'Missing receipt: %s\n' "$path" >&2; return 1
}
start() {
  local role="$1"
  node "$here/role.mjs" "$source_dir" "$case_dir" "$role" root > "$case_dir/$role.log" 2>&1 &
  pids+=("$!"); roles+=("$case_dir/$role")
  await_file "$case_dir/$role.ready.json"
}
for reason in new fork; do
  case_dir="$artifacts/$reason"; mkdir -p "$case_dir"
  start old
  printf '%s\n' "$reason" > "$case_dir/old.command"
  await_file "$case_dir/old.observed.json"
  jq -e '.state.members.root.live == false and (.state.cancelled | index("root") != null)' "$case_dir/old.observed.json" >/dev/null
  old_pid="$(jq -r .pid "$case_dir/old.ready.json")"
  ps -p "$old_pid" -o pid= -o lstart= -o command= > "$case_dir/old-before-reopen.ps"
  start replacement
  jq -e --slurpfile old "$case_dir/old.ready.json" '.pid != $old[0].pid and .registration.live and .registration.incarnation != $old[0].registration.incarnation' "$case_dir/replacement.ready.json" >/dev/null
  jq -e --slurpfile replacement "$case_dir/replacement.ready.json" '.members.root == $replacement[0].registration and (.cancelled | index("root") == null)' "$case_dir/team/state.json" >/dev/null
  ps -p "$old_pid" -o pid= -o lstart= -o command= > "$case_dir/old-after-reopen.ps"
  cmp "$case_dir/old-before-reopen.ps" "$case_dir/old-after-reopen.ps"
  jq -e 'length == 0' "$case_dir/old.signals.json" >/dev/null
  printf 'PASS root %s retirement allows another PID to reopen while original PID stays alive\n' "$reason"
done

#!/usr/bin/env bash
# Source after creating the lab: ctl, id and evidence belong to the caller.
# The argument names the scenario's retained final-status artifact.
lab_final_status="$1"
lab() { bash "$ctl" "$1" "$id" "${@:2}"; }
cleanup_lab() {
  local rc=$?
  trap - EXIT
  if ! lab status > "$lab_final_status" || ! jq -e 'any(.actors[]; .role == "server" and .alive) and any(.actors[]; .role == "provider" and .alive)' "$lab_final_status" >/dev/null; then
    printf 'INFRASTRUCTURE FAILURE: private server/provider lost\n' >&2
    rc=2
  fi
  lab cleanup || rc=2
  exit "$rc"
}
trap cleanup_lab EXIT

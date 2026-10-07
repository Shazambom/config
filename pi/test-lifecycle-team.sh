#!/usr/bin/env bash
# Regression coverage for stale team retirement and registration ownership.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/bootstrap.sh"
artifacts="$(mktemp -d "${TMPDIR:-/tmp}/pi-lifecycle-team.XXXXXX")"
printf 'Artifacts retained: %s\n' "$artifacts"
pids=()
roles=()
cleanup() {
  local original=$? i status=0
  for i in ${roles[@]+"${roles[@]}"}; do : > "$i.exit"; done
  for i in ${pids[@]+"${pids[@]}"}; do wait "$i" || status=1; done
  printf '{"allChildrenReaped":true,"cleanExit":%s}\n' "$([ "$status" -eq 0 ] && echo true || echo false)" > "$artifacts/cleanup.json"
  if [ "$status" -ne 0 ]; then exit 2; fi
  exit "$original"
}
trap cleanup EXIT
for name in $(compgen -e); do
  case "$name" in *API_KEY*|*TOKEN*|*SECRET*|PI_SUBAGENT*|PI_TEAM*|PI_LIFECYCLE_OWNER|PI_CODING_AGENT_DIR) unset "$name" ;; esac
done
export HOME="$artifacts/home" PI_CODING_AGENT_DIR="$artifacts/agent" PI_OFFLINE=1
mkdir -p "$HOME" "$PI_CODING_AGENT_DIR"
spec="$(jq -c '.[] | select(.name == "pi-interactive-subagents")' "$repo/pi/upstream.json")"
ref="$(jq -r .ref <<< "$spec")"
sha="$(jq -r .sha256 <<< "$spec")"
printf '%s\n' "$spec" > "$artifacts/source-pin.json"
pi_download_verified "https://codeload.github.com/amosblomqvist/pi-interactive-subagents/tar.gz/$ref" "$artifacts/source.tgz" "$sha"
tar -xzf "$artifacts/source.tgz" -C "$artifacts"
source_dir="$artifacts/pi-interactive-subagents-$ref"
(cd "$source_dir"; git apply --unidiff-zero "$repo/pi/patches/interactive-subagents.patch")
ln -s "$repo/pi/node_modules" "$source_dir/node_modules"
node_bin="$(command -v node)"
"$node_bin" "$repo/pi/tests/lifecycle-team/incarnation.mjs" "$source_dir" "$artifacts/same-process"
"$node_bin" "$repo/pi/tests/lifecycle-team/cleanup-reads.mjs" "$source_dir" "$artifacts/cleanup-reads"
"$node_bin" "$repo/pi/tests/lifecycle-team/admission.mjs" "$source_dir" "$artifacts/admission-adapter"
"$node_bin" "$repo/pi/tests/lifecycle-team/shutdown.mjs" "$source_dir" "$artifacts/shutdown"
"$node_bin" "$repo/pi/tests/lifecycle-team/abandoned-root.mjs" "$source_dir" "$artifacts/abandoned-root"
"$node_bin" "$repo/pi/tests/lifecycle-team/worker-admission.mjs" "$source_dir" "$artifacts/worker-admission"
for test in reload resumed-name arena-admission; do
  "$node_bin" "$repo/pi/tests/lifecycle-team/$test.mjs" "$source_dir" "$artifacts/$test"
done
for mode in count replacement survivor; do
  "$node_bin" "$repo/pi/tests/lifecycle-team/batch-retirement.mjs" "$source_dir" "$artifacts/batch-$mode" "$mode"
done
bash "$repo/pi/tests/lifecycle-team/root-replacement.sh" "$source_dir" "$artifacts/root-replacement"
await_file() {
  local path="$1" count=0
  while [ ! -f "$path" ]; do
    count=$((count + 1))
    if [ "$count" -gt 200 ]; then printf 'Timeout: %s\n' "$path" >&2; return 1; fi
    sleep 0.05
  done
}
start_role() {
  local role="$1" member="$2"
  "$node_bin" "$repo/pi/tests/lifecycle-team/role.mjs" "$source_dir" "$case_dir" "$role" "$member" > "$case_dir/$role.log" 2>&1 &
  pids+=("$!")
  roles+=("$case_dir/$role")
  await_file "$case_dir/$role.ready.json"
  jq -e '.pid > 0 and (.identity | length > 0) and .registration.pid == .pid and .registration.processIdentity == .identity' "$case_dir/$role.ready.json" >/dev/null
}
failures=0
for action in shutdown quiet; do
  for mode in control replacement; do
    case_dir="$artifacts/$action-$mode"
    mkdir -p "$case_dir"
    start_role old stable-member
    start_role sentinel sentinel
    if [ "$mode" = replacement ]; then
      start_role replacement stable-member
      jq -en --slurpfile old "$case_dir/old.ready.json" --slurpfile new "$case_dir/replacement.ready.json" '$old[0].pid != $new[0].pid and $old[0].identity != $new[0].identity' >/dev/null
    fi
    cp "$case_dir/team/state.json" "$case_dir/before.json"
    printf '%s\n' "$action" > "$case_dir/old.command"
    await_file "$case_dir/old.observed.json"
    # Capture persisted state and signal evidence before asking ANY role to exit.
    cp "$case_dir/team/state.json" "$case_dir/after.json"
    jq -e --slurpfile sentinel "$case_dir/sentinel.ready.json" '.members.sentinel == $sentinel[0].registration' "$case_dir/after.json" >/dev/null
    jq -e 'length == 0' "$case_dir/sentinel.signals.json" >/dev/null
    # ps is a direct, non-signalling liveness check, not an inference from live:true.
    for role in old sentinel $([ "$mode" = replacement ] && echo replacement); do
      pid="$(jq -r .pid "$case_dir/$role.ready.json")"
      ps -p "$pid" -o pid= -o lstart= -o command= > "$case_dir/$role.alive.txt"
    done
    if [ "$mode" = control ]; then
      jq -e '.state.members["stable-member"].live == false' "$case_dir/old.observed.json" >/dev/null
      printf 'PASS %s first-role-alone retirement\n' "$action"
    else
      jq -e 'length == 0' "$case_dir/replacement.signals.json" >/dev/null
      if jq -e --slurpfile new "$case_dir/replacement.ready.json" '.members["stable-member"] == $new[0].registration' "$case_dir/after.json" >/dev/null; then
        printf 'PASS %s replacement preserved\n' "$action"
      else
        printf 'FAIL %s stale callback retired replacement\n' "$action"
        failures=$((failures + 1))
      fi
    fi
    for role in old sentinel $([ "$mode" = replacement ] && echo replacement); do : > "$case_dir/$role.exit"; done
  done
done
printf '{"replacementFailures":%s}\n' "$failures" > "$artifacts/result.json"
[ "$failures" -eq 0 ]
for scenario in conflict owned switch-reopen quit unmanaged unprotected; do
  bash "$repo/pi/tests/lifecycle-team/admission-runtime.sh" "$source_dir" "$scenario" | tee "$artifacts/admission-$scenario.log"
done
# Freeze one private core copy for both real worker scenarios.
mkdir "$artifacts/core-snapshot"
cp -R "$repo/pi/agent/lifecycle" "$artifacts/core-snapshot/lifecycle"
shasum -a 256 "$artifacts"/core-snapshot/lifecycle/* > "$artifacts/lifecycle-core-hashes.txt"
for scenario in root-death window reload; do
  "$node_bin" "$repo/pi/tests/lifecycle-team/worker-root.mjs" "$source_dir" "$artifacts/worker-$scenario" "$artifacts/core-snapshot/lifecycle" "$scenario"
done

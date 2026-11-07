#!/usr/bin/env bash
# Explicit checked setup, called by init.sh after its existing Node/jq bootstrap.
set -euo pipefail
umask 077
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ $# == 1 && -n "$1" ]] || { echo 'Usage: delivery.sh NEW_RECEIPT' >&2; exit 2; }
parent="$(cd -- "$(dirname -- "$1")" && pwd -P)"
receipt="$parent/$(basename -- "$1")"
stage="$(mktemp -d "$parent/.pi-delivery.XXXXXX")"
operation="${stage##*/}"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
child=''
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT
# The initial atomic record deliberately makes no liveness or retry claim.
jq -n --arg id "$operation" --arg started "$started" \
  '{schema:1,operation_id:$id,started_at:$started,finished_at:null,
    completion:"not_observed",setup_exit:null,selected_package:null,
    artifact_check:{state:"unknown",reason:"not_run"},
    entry_point:"not_run",behavior:"not_run"}' > "$stage/initial.json"
# link addresses the exact destination, unlike ln when it is a directory.
if ! link "$stage/initial.json" "$receipt"; then
  echo 'Delivery refused: receipt destination must be new.' >&2
  exit 1
fi
interrupt() {
  trap '' INT TERM HUP
  # Only forward to our owned Bash child, never another process group. The
  # enclosing Pi Bash tool owns tree cancellation. No descendant-cleanup claim.
  if [[ -n "$child" ]]; then kill -TERM "$child" 2>/dev/null || true; fi
  echo "Delivery interrupted; completion not observed: $receipt" >&2
  exit "$1"
}
trap 'interrupt 130' INT
trap 'interrupt 143' TERM
trap 'interrupt 129' HUP
# A separate Bash preserves its own errexit. wait permits signal handling while
# setup runs; this is one owned command, not a retry or supervision loop.
bash "$repo/pi/setup.sh" --delivery-handoff "$stage/selected.json" <&0 &
child=$!
setup_exit=0
wait "$child" || setup_exit=$?
child=''
selected=''
if [[ -f "$stage/selected.json" ]]; then
  selected="$(jq -er '.package | select(type == "string" and length > 0)' "$stage/selected.json")" || selected=''
fi
printf '{"state":"unknown","reason":"selection_not_observed"}\n' > "$stage/check.json"
if [[ -n "$selected" ]]; then
  check_exit=0
  bash "$repo/pi/rpc-readiness.sh" "$selected" --check-json > "$stage/observation.json" 2> "$stage/diagnostics" || check_exit=$?
  # Reject broken observers, including a passed record accompanied by failure.
  if [[ $(wc -c < "$stage/observation.json") -le 32768 ]] &&
    jq -e -s --argjson code "$check_exit" '
      length == 1 and (.[0] |
        .schema == 1 and (.reason | type == "string") and
        (.package | type == "string") and (.version | type == "string") and
        (.checker_sha256 | test("^[0-9a-f]{64}$")) and
        (.assets | type == "array") and
        ((.state == "passed" and $code == 0 and
          (.manifest_sha256 | test("^[0-9a-f]{64}$")) and (.assets|length > 0)) or
         ((.state == "failed" or .state == "unknown") and $code != 0)))
    ' "$stage/observation.json" >/dev/null 2>&1; then
    cp "$stage/observation.json" "$stage/check.json"
  else
    printf '{"state":"unknown","reason":"invalid_observer_result"}\n' > "$stage/check.json"
  fi
  # Never include setup logs, environment or unbounded observer output.
  head -c 4096 "$stage/diagnostics" > "$stage/bounded-diagnostics"
else
  : > "$stage/bounded-diagnostics"
fi
state="$(jq -r .state "$stage/check.json")"
result=1
[[ "$setup_exit" != 0 || "$state" != passed ]] || result=0
jq --arg finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson setup_exit "$setup_exit" --arg selected "$selected" \
  --argjson operation_exit "$result" --slurpfile check "$stage/check.json" \
  --rawfile diagnostics "$stage/bounded-diagnostics" '
  .finished_at=$finished | .completion="observed" | .setup_exit=$setup_exit |
  .selected_package=(if $selected == "" then null else $selected end) |
  .operation_exit=$operation_exit | .artifact_check=$check[0] |
  .artifact_check.diagnostics=$diagnostics
' "$stage/initial.json" > "$stage/final.json"
# Cooperating invocations cannot replace the reserved destination. Refuse a
# changed destination rather than publishing into a directory or another file.
[[ -f "$receipt" && ! -L "$receipt" && "$receipt" -ef "$stage/initial.json" ]] || {
  echo 'Delivery failed: receipt reservation changed.' >&2; exit 1;
}
mv -f "$stage/final.json" "$receipt" || { echo 'Delivery failed: receipt publication failed.' >&2; exit 1; }
printf 'Pi delivery: setup exit %s; artifact check: %s; entry point: not run; behavior: not run\nReceipt: %s\n' "$setup_exit" "$state" "$receipt"
exit "$result"

#!/usr/bin/env bash
# Check wrapper outcomes without launching or signaling any process under test.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
proof="$(mktemp -d "${TMPDIR:-/tmp}/pi-cleanup-wrapper.XXXXXX")"
cat > "$proof/controller.sh" <<'SH'
#!/usr/bin/env bash
case "$1:$2" in
  status:lost) printf '{"actors":[]}\n' ;;
  status:query-error) exit 1 ;;
  status:*) printf '{"actors":[{"role":"server","alive":true},{"role":"provider","alive":true}]}\n' ;;
  cleanup:cleanup-error) exit 1 ;;
  cleanup:*) printf '{"success":true}\n' ;;
  *) exit 1 ;;
esac
SH
for spec in good:0:0 good:7:7 lost:0:2 query-error:0:2 cleanup-error:0:2; do
  IFS=: read -r scenario body_code expected <<< "$spec"
  rc=0
  bash -c 'set -euo pipefail; ctl="$1"; id="$2"; evidence="$3"; source "$4" "$evidence/$id-status.json"; exit "$5"' \
    -- "$proof/controller.sh" "$scenario" "$proof" "$here/runtime-common.sh" "$body_code" \
    > "$proof/$scenario-$body_code.log" 2>&1 || rc=$?
  [[ "$rc" == "$expected" ]] || { printf 'FAIL %s: expected %s, got %s\n' "$spec" "$expected" "$rc"; exit 1; }
done
printf 'PASS cleanup wrapper preserves assertion exits and reports infrastructure/cleanup errors\nEvidence: %s\n' "$proof"

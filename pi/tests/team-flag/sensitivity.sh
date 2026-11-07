#!/usr/bin/env bash
# Supply two already-applied trees: the pre-feature source and the candidate.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
old="$(cd -- "$1" && pwd)"
candidate="$(cd -- "$2" && pwd)"
artifacts="$(mktemp -d "${TMPDIR:-/tmp}/pi-team-flag-sensitivity.XXXXXX")"
chmod 700 "$artifacts"
printf 'Sensitivity artifacts retained: %s\n' "$artifacts"
if bash "$repo/pi/test-team-flag.sh" "$old" > "$artifacts/old.log" 2>&1; then
  echo 'FAIL old source unexpectedly passed' >&2; exit 1
fi
grep -q 'on: CLI exited' "$artifacts/old.log"
old_run="$(awk '/^Artifacts retained: / {print $3}' "$artifacts/old.log")"
grep -q 'Unknown option: --team' "$old_run/on/stderr.txt"
cp -R "$candidate" "$artifacts/no-delivery"
file="$artifacts/no-delivery/pi-extension/subagents/team-extension.ts"
# Disable only interval delivery; sending still commits to the real team log.
awk '!/notify\(store.pending\(member, seen\)/' "$file" > "$file.tmp"
mv "$file.tmp" "$file"
if bash "$repo/pi/test-team-flag.sh" "$artifacts/no-delivery" > "$artifacts/no-delivery.log" 2>&1; then
  echo 'FAIL broken delivery unexpectedly passed' >&2; exit 1
fi
grep -q 'rpc-peer: recipient provider context timeout' "$artifacts/no-delivery.log"
cp -R "$candidate" "$artifacts/early-flag"
file="$artifacts/early-flag/pi-extension/subagents/team-extension.ts"
awk '
  /store = TeamStore.create/ { sub(/pi.getFlag\("team"\)/, "factoryTeam") }
  { print }
  /pi.registerFlag\("team"/ { print "  const factoryTeam = pi.getFlag(\"team\");" }
' "$file" > "$file.tmp"
mv "$file.tmp" "$file"
if bash "$repo/pi/test-team-flag.sh" "$artifacts/early-flag" > "$artifacts/early-flag.log" 2>&1; then
  echo 'FAIL premature factory flag read unexpectedly passed' >&2; exit 1
fi
grep -q -- '--team must select active team_send before first provider request' "$artifacts/early-flag.log"
printf 'PASS old-source CLI rejection, broken-delivery recipient-context, and premature flag-read negative controls\n'

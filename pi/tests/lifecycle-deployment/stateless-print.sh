#!/usr/bin/env bash
# Targeted no-session compatibility check. Reuses the prepared deployment.
set -euo pipefail
umask 077
work="$(cd "${1:?Pass the retained proof directory}" && pwd -P)"
run="$(mktemp -d "$work/stateless-print.XXXXXXXX")"
printf 'Evidence: %s\n' "$run"
cp -R "$work/home/.pi/agent" "$run/agent"
cp "$work/repo/pi/tests/lifecycle-deployment/adapter.mjs" "$run/adapter.mjs"
chmod +x "$run/adapter.mjs"
jq -n --arg cli "$(jq -r .cli "$work/cli.json")" --arg agent "$run/agent" '{cli:$cli,agent:$agent}' > "$run/config.json"
shasum -a 256 "$run/agent/lifecycle/"* "$run/adapter.mjs" "$run/agent/settings.json" > "$run/input-sha256.txt"
ctl="$work/repo/pi/tests/lifecycle-lab/lab.sh"
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
cd "$evidence/cwd"
result=0
# Python supplies a bounded direct-child wait on macOS and Linux, not JSON parsing.
env -i "HOME=$evidence/home" "PATH=$PATH" "PI_CODING_AGENT_DIR=$evidence/agent" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 "LIFECYCLE_LAB=$evidence" "NODE_OPTIONS=--import=$work/repo/pi/tests/lifecycle-lab/provider.mjs" python3 - "$(command -v node)" "$run/adapter.mjs" --no-extensions --no-mcp --no-context-files --no-skills --no-prompt-templates --no-tools --no-session --print STATELESS_PRINT_INPUT > "$run/stdout.txt" 2> "$run/stderr.txt" <<'PY' || result=$?
import subprocess, sys
try:
    sys.exit(subprocess.run(sys.argv[1:], timeout=20).returncode)
except subprocess.TimeoutExpired:
    print('TIMEOUT after 20 seconds', file=sys.stderr)
    sys.exit(124)
PY
printf '%s\n' "$result" > "$run/exit-code.txt"
jq -s '[.[] | select(.event == "request") | .body]' "$evidence/events.jsonl" > "$run/requests.json"
[[ "$result" == 0 ]] || { echo "FAIL: stateless print exited $result; inspect $run/stderr.txt" >&2; exit 1; }
printf 'LAB_REPLY STATELESS_PRINT_INPUT\n' > "$run/expected-output.txt"
cmp "$run/expected-output.txt" "$run/stdout.txt"
jq -e 'length == 1 and (.[0].messages | map(select(.role == "user")) | last | .content | if type == "string" then . else map(select(.type == "text") | .text) | join("\n") end) == "STATELESS_PRINT_INPUT"' "$run/requests.json" >/dev/null
! grep -Eq 'OWNERSHIP PROTECTION FAILED|Investigate ownership protection failure' "$run/stderr.txt" "$run/stdout.txt"
printf 'PASS: actual default stateless print, exact reply, exactly one synthetic model request\n'

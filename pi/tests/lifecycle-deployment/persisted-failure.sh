#!/usr/bin/env bash
# Actual default print/RPC failure policy; accepts a frozen agent input explicitly.
set -euo pipefail
umask 077
work="$(cd "${1:?Proof directory required}" && pwd -P)"
input="$(cd "${2:?Frozen agent directory required}" && pwd -P)"
mode="${3:?Expected print or rpc}"
case "$mode" in print|rpc) ;; *) exit 2;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
run="$(mktemp -d "$work/persisted-failure-$mode.XXXXXXXX")"
printf 'Evidence: %s\n' "$run"
cp -R "$input" "$run/agent"
cp "$work/repo/pi/tests/lifecycle-deployment/adapter.mjs" "$run/adapter.mjs"
chmod +x "$run/adapter.mjs"
jq -n --arg cli "$(jq -r .cli "$work/cli.json")" --arg agent "$run/agent" '{cli:$cli,agent:$agent}' > "$run/config.json"
shasum -a 256 "$run/agent/lifecycle/"* "$run/adapter.mjs" "$run/agent/settings.json" > "$run/input-sha256.txt"
while IFS= read -r package; do
  find "$package" -type f -exec shasum -a 256 {} \;
done < <(jq -r '.packages[] | if type == "string" then . else .source end | select(contains("pi-interactive-subagents") or contains("pi-observational-memory"))' "$run/agent/settings.json") > "$run/reused-package-sha256.txt"
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
printf 'synthetic obstruction\n' > "$evidence/histories/.pi-lifecycle"
clean=(env -i "HOME=$evidence/home" "PATH=$PATH" "PI_CODING_AGENT_DIR=$evidence/agent" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 "LIFECYCLE_LAB=$evidence" "NODE_OPTIONS=--import=$work/repo/pi/tests/lifecycle-lab/provider.mjs")
cli=("$(command -v node)" "$run/adapter.mjs" --no-extensions --no-mcp --no-context-files --no-skills --no-prompt-templates --no-tools --session "$evidence/histories/shared.jsonl")
cd "$evidence/cwd"
result=0
if [[ "$mode" == print ]]; then
  input_text=PERSISTED_FAILURE_INPUT
  "${clean[@]}" python3 - "${cli[@]}" --print "$input_text" > "$run/stdout.txt" 2> "$run/stderr.txt" <<'PY' || result=$?
import subprocess, sys
try:
    sys.exit(subprocess.run(sys.argv[1:], timeout=20).returncode)
except subprocess.TimeoutExpired:
    print('TIMEOUT after 20 seconds', file=sys.stderr)
    sys.exit(124)
PY
else
  input_text=PERSISTED_RPC_FAILURE_INPUT
  jq -nc --arg message "$input_text" '{id:"failure-policy",type:"prompt",message:$message}' > "$run/prompt.jsonl"
  "${clean[@]}" python3 "$here/rpc-failure-probe.py" "$run" "${cli[@]}" --mode rpc || result=$?
fi
printf '%s\n' "$result" > "$run/exit-code.txt"
jq -s '[.[] | select(.event == "request") | .body]' "$evidence/events.jsonl" > "$run/requests.json"
[[ "$result" == 0 ]] || { echo "FAIL: $mode exited $result; inspect $run" >&2; exit 1; }
if [[ "$mode" == print ]]; then
  printf 'LAB_REPLY %s\n' "$input_text" > "$run/expected-output.txt"
  cmp "$run/expected-output.txt" "$run/stdout.txt"
else
  jq -es --arg reply "LAB_REPLY $input_text" 'any(.type == "response" and .id == "failure-policy" and .success == true) and any(.type == "agent_settled") and any(.type == "message_end" and .message.role == "assistant" and (.message.content | any(.type == "text" and .text == $reply)))' "$run/stdout.txt" >/dev/null
fi
jq -e --arg input "$input_text" 'length == 1 and (.[0].messages | map(select(.role == "user")) | last | .content | if type == "string" then . else map(select(.type == "text") | .text) | join("\n") end) == $input' "$run/requests.json" >/dev/null
grep -q 'SESSION UNPROTECTED' "$run/stderr.txt" "$run/stdout.txt"
! grep -q 'Investigate ownership protection failure' "$run/stderr.txt" "$run/stdout.txt" "$run/requests.json"
# A diagnostic must belong to this run's obstructed session, not copied evidence.
find "$run/agent/lifecycle-diagnostics" -type f -name '*.json' -exec jq -c . {} \; > "$run/diagnostics.jsonl"
jq -es --arg session "$evidence/histories/shared.jsonl" 'any(.code == "EEXIST" and .context.sessionFile == $session)' "$run/diagnostics.jsonl" >/dev/null
printf 'PASS: persisted %s guard failure warns, records diagnostic, executes supplied task once without investigation\n' "$mode"

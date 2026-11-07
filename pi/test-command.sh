#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi command.XXXXXX")"
test_dir="$(cd -- "$test_dir" && pwd -P)"
trap 'rm -rf -- "$test_dir"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
export HOME="$test_dir/home" PATH="$test_dir/bin:$PATH"
unset CONFIG_PI_HOME TMUX
mkdir -p "$HOME" "$test_dir/bin" "$test_dir/package/dist/bundle" "$test_dir/repo quote's/pi"
fixture="$test_dir/repo quote's"
cp "$repo/pi.sh" "$fixture/pi.sh"
cp "$repo/pi/command-path.sh" "$repo/pi/install-command.sh" "$repo/pi/launch-args.sh" "$fixture/pi/"
mkdir -p "$fixture/iterm2"
cp "$repo/iterm2/launch.sh" "$fixture/iterm2/"
export PI_TEST_INIT_LOG="$test_dir/init-args"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "$@" > "$PI_TEST_INIT_LOG"' > "$fixture/init.sh"
chmod +x "$fixture/init.sh"
: > "$fixture/pi/runtime.sh"
: > "$fixture/pi/jq.sh"
export PI_TEST_LOG="$test_dir/result" PI_TEST_ENTRY="$test_dir/bin/pi" PI_TEST_REAL="$test_dir/package/dist/bundle/cli.js"
export PI_TEST_READY_LOG="$test_dir/readiness"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" "$@" > "$PI_TEST_READY_LOG"' 'exit "${PI_TEST_READY_STATUS:-0}"' > "$fixture/pi/rpc-readiness.sh"
printf '%s\n' '#!/usr/bin/env bash' \
  '{ printf "cli\\n"; printf "%s\\n" "$PWD" "$@"; } > "$PI_TEST_LOG"' \
  'if [[ "${1:-}" == update ]]; then rm "$PI_TEST_ENTRY"; ln -s "$PI_TEST_REAL" "$PI_TEST_ENTRY"; fi' \
  'exit "${PI_TEST_EXIT:-0}"' > "$PI_TEST_REAL"
printf '%s\n' '#!/usr/bin/env bash' \
  '{ printf "tmux\\n"; printf "%s\\n" "$PWD" "$@"; } > "$PI_TEST_LOG"' > "$test_dir/bin/tmux"
chmod +x "$PI_TEST_REAL" "$test_dir/bin/tmux"
ln -s ../package/dist/bundle/cli.js "$PI_TEST_ENTRY"
bash "$fixture/pi/install-command.sh" "$PI_TEST_ENTRY"
cp "$PI_TEST_ENTRY" "$test_dir/expected-wrapper"
bash "$fixture/pi/install-command.sh" "$PI_TEST_ENTRY"
cmp "$PI_TEST_ENTRY" "$test_dir/expected-wrapper" || fail 'Non-idempotent wrapper'
source "$fixture/pi/command-path.sh"
[[ "$(pi_real_command "$PI_TEST_ENTRY")" == "$PI_TEST_REAL" ]] || fail 'Underlying CLI resolution'
cd "$fixture"
pi -p 'two words' '--literal' </dev/null
printf 'cli\n%s\n-p\ntwo words\n--literal\n' "$PWD" > "$test_dir/expected"
cmp "$PI_TEST_LOG" "$test_dir/expected" || fail 'Headless argument/cwd routing'
grep -qx -- '--pi-no-terminal' "$PI_TEST_INIT_LOG" || fail 'Headless launch configured terminal integration'
# T3 is explicit. Its normal launches must verify the selected runtime first.
pi --mode rpc --team --t3 </dev/null
printf 'cli\n%s\n--mode\nrpc\n--team\n--t3\n' "$PWD" > "$test_dir/expected"
cmp "$PI_TEST_LOG" "$test_dir/expected" || fail 'T3 arguments changed'
printf '%s\n--check\n' "$test_dir/package" > "$test_dir/expected-ready"
cmp "$PI_TEST_READY_LOG" "$test_dir/expected-ready" || fail 'T3 skipped runtime verification'
cp "$PI_TEST_LOG" "$test_dir/before-refusal"
if PI_TEST_READY_STATUS=1 pi --mode rpc --t3 </dev/null; then fail 'Unverified T3 runtime launched'; fi
cmp "$PI_TEST_LOG" "$test_dir/before-refusal" || fail 'CLI executed after readiness refusal'
# The native offline fork helper disables extensions, so extension-only flags
# must not make copying history fail. Normal launches keep those flags.
pi --mode rpc --team --t3 --offline --no-extensions --no-tools --fork 'saved history.jsonl' </dev/null
printf 'cli\n%s\n--mode\nrpc\n--offline\n--no-extensions\n--no-tools\n--fork\nsaved history.jsonl\n' "$PWD" > "$test_dir/expected"
cmp "$PI_TEST_LOG" "$test_dir/expected" || fail 'Offline fork retained extension-only flags'
pi --mode rpc --team --t3 --no-session --offline </dev/null
printf 'cli\n%s\n--mode\nrpc\n--team\n--t3\n--no-session\n--offline\n' "$PWD" > "$test_dir/expected"
cmp "$PI_TEST_LOG" "$test_dir/expected" || fail 'Discovery lost adapter flags'
pi -p -- '--t3' </dev/null
printf 'cli\n%s\n-p\n--\n--t3\n' "$PWD" > "$test_dir/expected"
cmp "$PI_TEST_LOG" "$test_dir/expected" || fail 'Prompt text interpreted as an adapter flag'
if PI_TEST_EXIT=17 pi --version </dev/null; then fail 'Lost failure exit code'; else [[ $? == 17 ]] || fail 'Wrong failure exit code'; fi
pi update </dev/null
pi_is_launcher "$PI_TEST_ENTRY" || fail 'Update did not restore wrapper'
[[ "$(pi_real_command "$PI_TEST_ENTRY")" == "$PI_TEST_REAL" ]] || fail 'Update lost CLI'

run_tty() {
  printf '#!/usr/bin/env bash\n%s\n' "$1" > "$test_dir/tty.sh"
  case "$(uname -s)" in
    Darwin) script -q /dev/null bash "$test_dir/tty.sh" >/dev/null ;;
    *) printf -v tty_command 'bash %q' "$test_dir/tty.sh"; script -q -e -c "$tty_command" /dev/null >/dev/null ;;
  esac
}
for terminal in iTerm.app Apple_Terminal vscode ''; do
  run_tty "TERM_PROGRAM='$terminal' pi 'two words'"
  grep -qx tmux "$PI_TEST_LOG" || fail 'Interactive launch did not use tmux'
  grep -Fxq "$PI_TEST_REAL" "$PI_TEST_LOG" || fail 'tmux launched wrapper recursively'
  grep -Fxq 'two words' "$PI_TEST_LOG" || fail 'tmux lost arguments'
  if [[ "$terminal" == iTerm.app ]]; then
    awk 'NR == 3 { if ($0 != "-CC") exit 1 } NR == 4 { if ($0 != "new-session") exit 1 }' "$PI_TEST_LOG" || fail 'iTerm2 did not use native integration'
  else
    if grep -Fxq -- '-CC' "$PI_TEST_LOG"; then fail "Control mode used in $terminal"; fi
  fi
  run_tty "TERM_PROGRAM='$terminal' TMUX=fixture pi 'inside tmux'"
  grep -qx cli "$PI_TEST_LOG" || fail 'Nested tmux launch'
done
run_tty 'unset TERM_PROGRAM; pi "no terminal identification"'
if grep -Fxq -- '-CC' "$PI_TEST_LOG"; then fail 'Control mode used without terminal identification'; fi
TERM_PROGRAM=iTerm.app pi 'noninteractive input' </dev/null
grep -qx cli "$PI_TEST_LOG" || fail 'tmux used without a TTY'
for args in '--help' '--version' '-p prompt' '--mode rpc' '--mode=json' '--list-models'; do
  run_tty "TERM_PROGRAM=iTerm.app pi $args"
  grep -qx cli "$PI_TEST_LOG" || fail "tmux used for $args"
done
rm "$PI_TEST_ENTRY"
cp "$PI_TEST_REAL" "$PI_TEST_ENTRY"
if bash "$fixture/pi/install-command.sh" "$PI_TEST_ENTRY" 2>/dev/null; then fail 'Overwrote unmanaged executable'; fi
cmp "$PI_TEST_ENTRY" "$PI_TEST_REAL" || fail 'Unmanaged executable changed'
printf '%s\n' 'PASS: executable wrapper, idempotence, CLI resolution, arguments/cwd, exit status, update repair, real TTY iTerm2/native and standard tmux routing, headless bypass and unmanaged-file protection.'

#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi command.XXXXXX")"
test_dir="$(cd -- "$test_dir" && pwd -P)"
trap 'rm -rf -- "$test_dir"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
export HOME="$test_dir/home" PATH="$test_dir/bin:$PATH"
unset CONFIG_PI_HOME TMUX
mkdir -p "$HOME" "$test_dir/bin" "$test_dir/package" "$test_dir/repo quote's/pi"
fixture="$test_dir/repo quote's"
cp "$repo/pi.sh" "$fixture/pi.sh"
cp "$repo/pi/command-path.sh" "$repo/pi/install-command.sh" "$fixture/pi/"
printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/init.sh"
chmod +x "$fixture/init.sh"
: > "$fixture/pi/runtime.sh"
: > "$fixture/pi/jq.sh"
export PI_TEST_LOG="$test_dir/result" PI_TEST_ENTRY="$test_dir/bin/pi" PI_TEST_REAL="$test_dir/package/cli"
printf '%s\n' '#!/usr/bin/env bash' \
  '{ printf "cli\\n"; printf "%s\\n" "$PWD" "$@"; } > "$PI_TEST_LOG"' \
  'if [[ "${1:-}" == update ]]; then rm "$PI_TEST_ENTRY"; ln -s "$PI_TEST_REAL" "$PI_TEST_ENTRY"; fi' \
  'exit "${PI_TEST_EXIT:-0}"' > "$PI_TEST_REAL"
printf '%s\n' '#!/usr/bin/env bash' \
  '{ printf "tmux\\n"; printf "%s\\n" "$PWD" "$@"; } > "$PI_TEST_LOG"' > "$test_dir/bin/tmux"
chmod +x "$PI_TEST_REAL" "$test_dir/bin/tmux"
ln -s ../package/cli "$PI_TEST_ENTRY"
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
run_tty 'pi "two words"'
grep -qx tmux "$PI_TEST_LOG" || fail 'Interactive launch did not use tmux'
grep -Fxq "$PI_TEST_REAL" "$PI_TEST_LOG" || fail 'tmux launched wrapper recursively'
grep -Fxq 'two words' "$PI_TEST_LOG" || fail 'tmux lost arguments'
run_tty 'TMUX=fixture pi "inside tmux"'
grep -qx cli "$PI_TEST_LOG" || fail 'Nested tmux launch'
for args in '--help' '--version' '-p prompt' '--mode rpc' '--mode=json' '--list-models'; do
  run_tty "pi $args"
  grep -qx cli "$PI_TEST_LOG" || fail "tmux used for $args"
done
rm "$PI_TEST_ENTRY"
cp "$PI_TEST_REAL" "$PI_TEST_ENTRY"
if bash "$fixture/pi/install-command.sh" "$PI_TEST_ENTRY" 2>/dev/null; then fail 'Overwrote unmanaged executable'; fi
cmp "$PI_TEST_ENTRY" "$PI_TEST_REAL" || fail 'Unmanaged executable changed'
printf '%s\n' 'PASS: executable wrapper, idempotence, CLI resolution, arguments/cwd, exit status, update repair, real TTY tmux routing and unmanaged-file protection.'

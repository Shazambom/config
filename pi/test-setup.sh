#!/usr/bin/env bash
# Regression checks for deployment validation and preservation of private state.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
[[ $# == 0 ]] || fail 'Usage: pi/test-setup.sh'
agent="$CONFIG_PI_HOME/agent"
commands="$HOME/.claude/commands"
mkdir -p "$commands/nested"
odd_name=$'quoted "command"\nname.md'
printf '%s\n' 'Unusual filename fixture.' > "$commands/nested/$odd_name"
printf '%s\n' '{"fixture":"not a credential"}' > "$agent/auth.json"
cp "$agent/auth.json" "$test_dir/auth.expected"
"$repo/init.sh" --pi
jq -e --arg path "$commands/nested/$odd_name" '.prompts | index($path) != null' \
  "$agent/settings.json" >/dev/null || fail 'Unusual command path changed'
cmp -s "$agent/auth.json" "$test_dir/auth.expected" || fail 'Private auth overwritten'
cp "$agent/settings.json" "$test_dir/settings.expected"

expect_setup_failure() {
  if "$repo/init.sh" --pi > "$test_dir/setup.log" 2>&1; then
    fail "Setup unexpectedly accepted $1"
  fi
  cmp -s "$agent/settings.json" "$test_dir/settings.expected" || fail "$1 changed deployed settings"
  [[ -z "$(find "$agent" -name '.deploy.*' -print)" ]] || fail "$1 leaked staging files"
}
cp "$commands/nested/$odd_name" "$commands/$odd_name"
expect_setup_failure 'duplicate commands'
grep -q 'Duplicate Claude command /' "$test_dir/setup.log" || fail 'Missing duplicate diagnostic'
rm "$commands/$odd_name"
# Inject discovery failures without modifying repository resources.
real_find="$(command -v find)"
mkdir "$test_dir/bin"
printf '#!/usr/bin/env bash\nfor arg; do\n  if [[ "$arg" == "$PI_TEST_FAIL_DIR" ]]; then exit 42; fi\ndone\nexec "$PI_TEST_FIND" "$@"\n' > "$test_dir/bin/find"
chmod +x "$test_dir/bin/find"
export PI_TEST_FIND="$real_find" PATH="$test_dir/bin:$PATH"
export PI_TEST_FAIL_DIR="$commands"
expect_setup_failure 'command discovery failure'
export PI_TEST_FAIL_DIR="$repo/pi/agent"
expect_setup_failure 'resource discovery failure'
# A globally available Pi must not cause npm inspection, upgrade or downgrade.
unset PI_TEST_FAIL_DIR
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_dir/bin/pi"
printf '#!/usr/bin/env bash\necho "Unexpected global npm call" >&2\nexit 99\n' > "$test_dir/bin/npm"
chmod +x "$test_dir/bin/pi" "$test_dir/bin/npm"
(unset CONFIG_PI_HOME; "$repo/init.sh" --pi)
jq -e '.packages | length > 0' "$HOME/.pi/agent/settings.json" >/dev/null || fail 'Standard global config missing'
printf '%s\n' 'PASS: deployment validation, private-state preservation, standard config and existing global Pi left alone.'

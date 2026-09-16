#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/iterm-preferences.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/bin" "$test_dir/state"
export PATH="$test_dir/bin:$PATH" ITERM_TEST_STATE="$test_dir/state" ITERM_TEST_OS=Darwin
unset CONFIG_PI_HOME
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$ITERM_TEST_OS"\n' > "$test_dir/bin/uname"
cat > "$test_dir/bin/defaults" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "$2" == com.googlecode.iterm2 ]]
case "$1" in
  read)
    [[ -f "$ITERM_TEST_STATE/$3" ]] || exit 1
    printf '%s\n' "$(< "$ITERM_TEST_STATE/$3")"
    ;;
  write)
    printf '%s %s %s\n' "$3" "$4" "$5" >> "$ITERM_TEST_STATE/writes"
    value="$5"
    case "$value" in true) value=1 ;; false) value=0 ;; esac
    printf '%s\n' "$value" > "$ITERM_TEST_STATE/$3"
    ;;
  *) exit 1 ;;
esac
STUB
chmod +x "$test_dir/bin/uname" "$test_dir/bin/defaults"
printf 'keep\n' > "$ITERM_TEST_STATE/UnrelatedSetting"
bash "$repo/iterm2/setup.sh"
printf '%s\n' 'OpenTmuxWindowsIn -int 2' 'AutoHideTmuxClientSession -bool true' 'CopySelection -bool false' 'EnableAPIServer -bool true' > "$test_dir/expected"
cmp "$test_dir/expected" "$ITERM_TEST_STATE/writes"
[[ "$(< "$ITERM_TEST_STATE/UnrelatedSetting")" == keep ]]
[[ "$(< "$ITERM_TEST_STATE/OpenTmuxWindowsIn")" == 2 ]]
[[ "$(< "$ITERM_TEST_STATE/AutoHideTmuxClientSession")" == 1 ]]
[[ "$(< "$ITERM_TEST_STATE/CopySelection")" == 0 ]]
[[ "$(< "$ITERM_TEST_STATE/EnableAPIServer")" == 1 ]]
bash "$repo/iterm2/setup.sh"
cmp "$test_dir/expected" "$ITERM_TEST_STATE/writes"
rm "$ITERM_TEST_STATE/writes" "$ITERM_TEST_STATE/OpenTmuxWindowsIn"
ITERM_TEST_OS=Linux bash "$repo/iterm2/setup.sh"
CONFIG_PI_HOME="$test_dir/isolated" bash "$repo/iterm2/setup.sh"
[[ ! -e "$ITERM_TEST_STATE/writes" ]]
printf '1\n' > "$ITERM_TEST_STATE/LoadPrefsFromCustomFolder"
bash "$repo/iterm2/setup.sh"
[[ ! -e "$ITERM_TEST_STATE/writes" ]]
printf '%s\n' 'PASS: iTerm2 tab/bury/copy preferences, idempotence, unrelated settings, Linux, isolated home and external preferences.'

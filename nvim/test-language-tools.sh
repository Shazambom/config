#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/language-tools-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT
export HOME="$work/home" FAKE_BIN="$work/bin" TOOL_LOG="$work/actions"
export FAKE_RUSTUP="$work/rustup" FAKE_INSTALLER="$work/installer"
mkdir -p "$HOME" "$FAKE_BIN"
export PATH="$FAKE_BIN:/usr/bin:/bin"
printf '%s\n' 'preserve profile' > "$HOME/.profile"
cp "$HOME/.profile" "$work/profile"
cat > "$FAKE_BIN/npm" <<'SH'
#!/usr/bin/env bash
set -eu
[[ "$*" == 'install -g pyright' ]]
printf 'npm\n' >> "$TOOL_LOG"
printf '#!/bin/sh\nexit 0\n' > "$FAKE_BIN/pyright"
chmod +x "$FAKE_BIN/pyright"
SH
cat > "$FAKE_BIN/curl" <<'SH'
#!/usr/bin/env bash
set -eu
[[ "$*" == *https://sh.rustup.rs* ]]
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -o ]]; then cp "$FAKE_INSTALLER" "$2"; exit; fi
  shift
done
exit 1
SH
cat > "$FAKE_RUSTUP" <<'SH'
#!/usr/bin/env bash
set -eu
[[ "$CARGO_HOME" == "$HOME/.cargo" && "$RUSTUP_HOME" == "$HOME/.rustup" ]]
case "$*" in
  default) [[ -f "$HOME/active" ]] ;;
  'default stable') printf 'default\n' >> "$TOOL_LOG"; printf 'stable\n' > "$HOME/active" ;;
  'component add rust-analyzer rustfmt rust-src') printf 'components\n' >> "$TOOL_LOG" ;;
  *) exit 1 ;;
esac
SH
cat > "$FAKE_INSTALLER" <<'SH'
#!/bin/sh
set -eu
case "$*" in *--no-modify-path*) ;; *) exit 1 ;; esac
printf 'installer\n' >> "$TOOL_LOG"
mkdir -p "$CARGO_HOME/bin"
cp "$FAKE_RUSTUP" "$CARGO_HOME/bin/rustup"
printf 'stable\n' > "$HOME/active"
SH
chmod +x "$FAKE_BIN/npm" "$FAKE_BIN/curl" "$FAKE_RUSTUP"
export CARGO_HOME="$work/wrong-cargo" RUSTUP_HOME="$work/wrong-rustup"
bash "$repo/nvim/setup-language-tools.sh"
printf 'custom-toolchain\n' > "$HOME/active"
bash "$repo/nvim/setup-language-tools.sh"
[[ "$(< "$HOME/active")" == custom-toolchain ]]
[[ "$(grep -c '^npm$' "$TOOL_LOG")" == 1 ]]
[[ "$(grep -c '^installer$' "$TOOL_LOG")" == 1 ]]
[[ "$(grep -c '^components$' "$TOOL_LOG")" == 2 ]]
[[ ! -e "$work/wrong-cargo" && ! -e "$work/wrong-rustup" ]]
rm "$HOME/active"
bash "$repo/nvim/setup-language-tools.sh"
[[ "$(grep -c '^default$' "$TOOL_LOG")" == 1 ]]
[[ "$(< "$HOME/active")" == stable ]]
cmp "$work/profile" "$HOME/.profile"
printf '%s\n' 'PASS: language-tool bootstrap, repeat setup, fixed home paths, existing toolchain and shell profile preservation.'

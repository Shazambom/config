#!/usr/bin/env bash
set -euo pipefail
command -v pyright >/dev/null 2>&1 || npm install -g pyright
export CARGO_HOME="$HOME/.cargo" RUSTUP_HOME="$HOME/.rustup"
rustup="$CARGO_HOME/bin/rustup"
if [[ ! -x "$rustup" ]]; then
  installer="$(mktemp "${TMPDIR:-/tmp}/portable-rustup.XXXXXX")"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o "$installer"
  sh "$installer" -y --profile minimal --default-toolchain stable --no-modify-path
fi
if ! "$rustup" default >/dev/null 2>&1; then
  "$rustup" default stable
fi
"$rustup" component add rust-analyzer rustfmt rust-src

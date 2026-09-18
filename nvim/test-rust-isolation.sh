#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/design-rust-isolation.XXXXXX")"
trap 'rm -rf "$work"' EXIT
export PATH="$HOME/.cargo/bin:$PATH"
python3 "$repo/nvim/tests/rustup-isolation.py" "$HOME/.cargo/bin/cargo"
mkdir -p "$work/project/.cargo" "$work/project/design"
printf '[build]\ntarget-dir = "%s"\n' "$work/escaped-config" > "$work/project/.cargo/config.toml"
cp "$repo/claude/skills/design/references/design.rs.txt" "$work/project/design/design.rs"
cp "$repo/claude/skills/design/references/support.rs.txt" "$work/project/design/support.rs"
printf '[package]\nname = "design-session"\nversion = "0.0.0"\nedition = "2021"\n[lib]\npath = "design.rs"\n[workspace]\n' > "$work/project/design/Cargo.toml"
(
  cd "$work/project/design"
  export CARGO_TARGET_DIR="$work/escaped-env"
  RUSTUP_AUTO_INSTALL=0 CARGO_NET_OFFLINE=true cargo check --offline --lib --target-dir "$PWD/target"
)
[[ ! -e "$work/escaped-config" && ! -e "$work/escaped-env" ]]
[[ -n "$(find "$work/project/design/target" -name '*.rmeta' -print)" ]]
printf '%s\n' 'PASS: missing ancestor toolchain cannot download; Cargo output stays local despite ancestor configuration and inherited target-directory environment.'

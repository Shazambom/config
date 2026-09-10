#!/usr/bin/env bash
set -euo pipefail
[[ -z "${CONFIG_PI_HOME:-}" ]] || exit 0
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
config_dir="$HOME/.config/portable-pi"
config="$config_dir/tmux.conf"
rc="$HOME/.tmux.conf"
mkdir -p "$config_dir"
if [[ -L "$config" || ( -e "$config" && ! -f "$config" ) ]]; then
  printf 'Refusing to replace non-regular tmux defaults: %s\n' "$config" >&2
  exit 1
fi
cp "$repo/tmux/tmux.conf" "$config"
escaped=${config//\\/\\\\}
escaped=${escaped//\"/\\\"}
escaped=${escaped//\$/\\\$}
source_line="source-file \"$escaped\""
if [[ -e "$rc" && ! -f "$rc" ]] || [[ -L "$rc" && ! -e "$rc" ]]; then
  printf 'Cannot append tmux defaults to: %s\n' "$rc" >&2
  exit 1
fi
if [[ ! -f "$rc" ]] || ! grep -Fqx -- "$source_line" "$rc"; then
  printf '\n%s\n' "$source_line" >> "$rc"
fi
if [[ -n "${TMUX:-}" ]] && command -v tmux >/dev/null 2>&1; then
  tmux source-file "$config"
fi

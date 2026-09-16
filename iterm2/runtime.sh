#!/usr/bin/env bash
set -euo pipefail
[[ -z "${CONFIG_PI_HOME:-}" && "$(uname -s)" == Darwin ]] || exit 0
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
runtime="$HOME/.config/portable-pi/iterm2-venv"
requirements="$repo/iterm2/requirements.txt"
if [[ -x "$runtime/bin/python3" ]] && cmp -s "$requirements" "$runtime/.portable-requirements"; then
  exit 0
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'Python 3 is unavailable; iTerm2 tab repositioning will be skipped.' >&2
  exit 0
fi
mkdir -p "$(dirname -- "$runtime")"
if [[ ! -x "$runtime/bin/python3" ]]; then
  python3 -m venv "$runtime"
fi
"$runtime/bin/python3" -m pip install --disable-pip-version-check --quiet --only-binary=:all: --no-deps --index-url https://pypi.org/simple -r "$requirements"
"$runtime/bin/python3" -c 'import iterm2, google.protobuf, websockets'
cp "$requirements" "$runtime/.portable-requirements"

#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

as_root() {
  if [[ "$(id -u)" == 0 ]]; then "$@"; else sudo "$@"; fi
}

if ! command -v tmux >/dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin)
      command -v brew >/dev/null 2>&1 || {
        echo 'Pi needs Homebrew to install tmux on macOS. Install Homebrew, then rerun init.sh --pi.' >&2
        exit 1
      }
      brew install tmux
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        as_root apt-get update
        as_root apt-get install -y tmux
      elif command -v dnf >/dev/null 2>&1; then
        as_root dnf install -y tmux
      elif command -v pacman >/dev/null 2>&1; then
        as_root pacman -S --needed --noconfirm tmux
      else
        echo 'No supported package manager for tmux. Use apt-get, dnf, pacman, or Homebrew.' >&2
        exit 1
      fi
      ;;
  esac
fi

node "$repo/pi/node_modules/playwright-core/cli.js" install chromium
if [[ "$(uname -s)" == Linux ]]; then
  marker="${CONFIG_PI_RUNTIME_DIR:-$HOME/.local/share/config-pi/runtime}/chromium-system-deps-$(jq -r '.dependencies["playwright-core"]' "$repo/pi/package.json")"
  if [[ ! -f "$marker" ]]; then
    node "$repo/pi/node_modules/playwright-core/cli.js" install-deps chromium
    mkdir -p "$(dirname -- "$marker")"
    touch "$marker"
  fi
fi

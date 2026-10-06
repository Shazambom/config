#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-init-target.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/repo/pi" "$work/repo/tmux" "$work/repo/iterm2" "$work/home"
cp "$repo/init.sh" "$work/repo/init.sh"
printf 'ensure_pi_runtime() { :; }\n' > "$work/repo/pi/runtime.sh"
printf 'ensure_pi_jq() { :; }\n' > "$work/repo/pi/jq.sh"
for pair in pi/setup.sh:pi tmux/setup.sh:tmux iterm2/setup.sh:iterm2 iterm2/runtime.sh:iterm-runtime; do
  printf 'printf "%%s\\n" %q >> %q\n' "${pair#*:}" "$work/calls" > "$work/repo/${pair%:*}"
done
HOME="$work/home" CONFIG_PI_HOME="$work/managed" bash "$work/repo/init.sh" --pi-no-terminal
printf 'pi\n' > "$work/expected"
cmp "$work/calls" "$work/expected"
: > "$work/calls"
HOME="$work/home" CONFIG_PI_HOME="$work/managed" bash "$work/repo/init.sh" --pi
printf 'pi\ntmux\niterm2\niterm-runtime\n' > "$work/expected"
cmp "$work/calls" "$work/expected"
: > "$work/calls"
if HOME="$work/home" bash "$work/repo/init.sh" --unknown; then exit 1; fi
[[ ! -s "$work/calls" ]]
echo 'PASS: Pi-only deployment skips terminal setup; --pi retains integrations; invalid options do nothing.'

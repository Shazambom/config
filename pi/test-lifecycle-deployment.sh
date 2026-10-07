#!/usr/bin/env bash
# Private deployment proof. Retains evidence; never deploys into the invoking HOME.
set -euo pipefail
umask 077
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ${1:-} == --runtime ]]; then
  proof="${2:?Pass the retained proof directory}"
  exec bash "$proof/repo/pi/tests/lifecycle-deployment/runtime.sh" "$proof"
fi
[[ $# == 0 ]] || { echo 'Usage: bash pi/test-lifecycle-deployment.sh [--runtime PROOF_DIRECTORY]' >&2; exit 2; }
for tool in tmux node jq python3; do
  command -v "$tool" >/dev/null || { echo "STOP: missing $tool; setup could install host tools. Ask before proceeding." >&2; exit 2; }
done
runtime="${CONFIG_PI_RUNTIME_DIR:-$HOME/.local/share/config-pi/runtime}"
[[ -d "$runtime" ]] || { echo 'STOP: existing private runtime required' >&2; exit 2; }
if [[ $(uname -s) == Linux ]]; then
  version="$(jq -r '.dependencies["playwright-core"]' "$repo/pi/package.json")"
  [[ -f "$runtime/chromium-system-deps-$version" ]] || { echo 'STOP: Chromium system dependencies not confirmed; ask before installing host tools.' >&2; exit 2; }
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-deployment.XXXXXXXX")"
printf 'Evidence: %s\n' "$work"
mkdir -p "$work/repo" "$work/home" "$work/cache" "$work/deny-bin" "$work/tmp"
# Freeze complete private writable copies, including patched dependencies. No shared symlinks.
(cd "$repo"; tar -cf - init.sh claude pi) | (cd "$work/repo"; tar -xf -)
cp -R "$runtime" "$work/runtime"
case "$(uname -s)" in Darwin) browser_cache="$HOME/Library/Caches/ms-playwright" ;; *) browser_cache="${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright" ;; esac
if [[ -d "$browser_cache" ]]; then cp -R "$browser_cache" "$work/browser-cache"; else mkdir "$work/browser-cache"; fi
bash "$repo/pi/tests/lifecycle-lab/lab.sh" resolve > "$work/cli.json"
cli="$(jq -r .cli "$work/cli.json")"
env -i "HOME=$work/home" "PATH=$PATH" node "$cli" --version > "$work/cli-version.txt"
(cd "$(dirname "$cli")"; shasum -a 256 cli-runtime.js) > "$work/cli-runtime-sha256.txt"
# Hash frozen inputs before setup refreshes patched upstream trees.
(cd "$work/repo"; find init.sh claude pi/agent pi/patches pi/tests/lifecycle-deployment pi/tests/lifecycle-lab -type f -exec shasum -a 256 {} \; ; shasum -a 256 pi/setup.sh pi/upstream.json pi/package-lock.json) > "$work/input-sha256.txt"
# Defense in depth: none of these installers are permitted, even after preflight.
for tool in brew sudo apt-get dnf pacman; do
  printf '#!/bin/sh\necho "STOP: host installer forbidden in deployment proof" >&2\nexit 97\n' > "$work/deny-bin/$tool"
  chmod +x "$work/deny-bin/$tool"
done
clean=(env -i "HOME=$work/home" "PATH=$work/deny-bin:$PATH" "TMPDIR=$work/tmp" "XDG_CACHE_HOME=$work/cache" "npm_config_cache=$work/cache/npm" "JITI_CACHE_DIR=$work/cache/jiti" "CONFIG_PI_HOME=$work/home/.pi" "CONFIG_PI_RUNTIME_DIR=$work/runtime" "PLAYWRIGHT_BROWSERS_PATH=$work/browser-cache" CI=1)
"${clean[@]}" bash "$work/repo/init.sh" --pi-no-terminal > "$work/setup.log" 2>&1 || { echo "FAIL: isolated setup; inspect $work/setup.log" >&2; exit 2; }
agent="$work/home/.pi/agent"
cp "$agent/settings.json" "$work/deployed-settings.json"
# Deliberately keep this RED until the production default is enabled by its owner.
result=0
if jq -e '(.extensions // []) | any(. == "./lifecycle/session-lifecycle.ts" or . == "lifecycle/session-lifecycle.ts")' "$agent/settings.json" >/dev/null; then
  echo 'PASS: deployed settings explicitly activate lifecycle/session-lifecycle.ts' | tee "$work/activation.txt"
else
  echo 'RED: deployed settings do not activate lifecycle/session-lifecycle.ts' | tee "$work/activation.txt"
  result=1
fi
"${clean[@]}" node "$work/repo/pi/tests/lifecycle-deployment/snippets.mjs" > "$work/snippets.log" 2>&1 || { echo "FAIL: snippet proof; inspect $work/snippets.log" >&2; exit 2; }
printf 'PASS: direct Jiti deployed picker and exact scope-creep + research-escape-hatch input transform\n'
printf 'Runtime checkpoint: bash %q --runtime %q\n' "$repo/pi/test-lifecycle-deployment.sh" "$work"
exit "$result"

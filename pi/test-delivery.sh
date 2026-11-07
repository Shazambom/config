#!/usr/bin/env bash
# Retained private evidence. No downloads or deployment into the invoking HOME.
set -euo pipefail
umask 077
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/command-path.sh"
cli="$(pi_real_command "$(command -v pi)")"
package="${cli%/dist/bundle/cli.js}"
[[ "$package" != "$cli" ]] || exit 2
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-delivery.XXXXXX")"
printf 'Evidence: %s\n' "$work"
mkdir -p "$work/repo" "$work/home" "$work/bin"
# Same private snapshot approach as test-lifecycle-deployment.sh.
(cd "$repo"; tar -cf - init.sh pi.sh claude pi) | (cd "$work/repo"; tar -xf -)
# Reuse the native package copier; only private package assets may be patched.
bash "$repo/pi/tests/rpc-readiness/copy-package.sh" "$package" "$work/package"
# Bootstrap fixtures from test-init-target.sh, with actual setup.sh retained.
printf 'ensure_pi_runtime() { :; }\n' > "$work/repo/pi/runtime.sh"
printf 'ensure_pi_jq() { :; }\n' > "$work/repo/pi/jq.sh"
# Setup's unrelated installers are outside this test. Refuse any accidental download.
for tool in npm curl brew sudo apt-get; do
  printf '#!/bin/sh\nexit 97\n' > "$work/bin/$tool"
  chmod +x "$work/bin/$tool"
done
for helper in upstream system-tools path-completion render-width; do
  printf ':\n' > "$work/repo/pi/$helper.sh"
done
# Select the copied installed runtime as the private fallback.
rm -rf "$work/repo/pi/node_modules/@earendil-works/pi-coding-agent"
ln -s "$work/package" "$work/repo/pi/node_modules/@earendil-works/pi-coding-agent"
# Force a controlled apply refusal, while preserving the check implementation.
cp "$work/repo/pi/rpc-readiness.sh" "$work/repo/pi/rpc-readiness-real.sh"
printf '#!/usr/bin/env bash\nif [[ ${2:---apply} == --apply ]]; then echo "Controlled RPC patch refusal" >&2; exit 1; fi\nexec bash "$(dirname "$0")/rpc-readiness-real.sh" "$@"\n' > "$work/repo/pi/rpc-readiness.sh"
# Calibrate a known-good observation, then reverse only the private known patch.
bash "$repo/pi/rpc-readiness.sh" "$work/package" > "$work/prepare-good.log"
bash "$repo/pi/rpc-readiness.sh" "$work/package" --check-json > "$work/positive-observation.json" 2> "$work/positive-observation.log"
if bash "$repo/pi/rpc-readiness.sh" "$work/package" --check > "$work/initial-check.log" 2>&1; then
  (cd "$work/package"; GIT_CEILING_DIRECTORIES="$work" git apply -R "$repo/pi/patches/rpc-readiness.patch")
  chunk=dist/bundle/chunks/chunk-H33F2TZD.js
  jq -jn --rawfile code "$work/package/$chunk" --slurpfile edits "$repo/pi/patches/rpc-readiness-bundle.json" '
    reduce $edits[0][] as $edit ($code; split($edit.new) as $parts |
      if ($parts|length) != 2 then error("reverse match") else $parts|join($edit.old) end)
  ' > "$work/reversed"
  mv "$work/reversed" "$work/package/$chunk"
fi
# This mutant deliberately bypasses the protected observation with stale good
# output. The unchanged acceptance assertion below must reject it.
if [[ "${1:-}" == --without-check ]]; then
  printf '#!/usr/bin/env bash\nif [[ ${2:---apply} == --check-json ]]; then jq . %q; exit 0; fi\nexit 1\n' "$work/positive-observation.json" > "$work/repo/pi/rpc-readiness.sh"
fi
clean=(env -i "HOME=$work/home" "PATH=$work/bin:$PATH" "CONFIG_PI_HOME=$work/state" CONFIG_PI_NO_PROMPT=1)
# The acceptance assertion stays identical from RED through GREEN.
result=0
"${clean[@]}" bash "$work/repo/init.sh" --pi-delivery "$work/failed.json" > "$work/failed.log" 2>&1 || result=$?
printf '%s\n' "$result" > "$work/acceptance-exit.txt"
cp "$work/failed.log" "$work/acceptance-command.log"
[[ "$result" != 0 ]]
jq -e '.setup_exit == 0 and .artifact_check.state == "failed" and .entry_point == "not_run" and .behavior == "not_run"' "$work/failed.json" > "$work/acceptance.txt"
echo 'PASS: setup zero plus unpatched assets fails checked delivery without claiming runtime behavior'
printf '%s\n' "$work" > "$work/evidence-path.txt"
"${clean[@]}" node "$repo/pi/tests/delivery/runtime.mjs" "$work/package/dist/bundle/cli.js" "$work"
bash "$repo/pi/tests/delivery/controls.sh" "$work" "$repo"

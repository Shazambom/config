#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$repo/pi/command-path.sh"
source "$repo/pi/path-completion.sh"
cli="$(pi_real_command "$(command -v pi)")"
original="${cli%/dist/bundle/cli.js}"
[[ "$original" != "$cli" ]] || { echo 'Expected active bundled Pi CLI' >&2; exit 1; }
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-rpc-readiness-deployment.XXXXXX")"
chmod 700 "$work"
printf 'Deployment evidence retained: %s\n' "$work"
package="$work/package"
files=(dist/modes/rpc/rpc-mode.js dist/core/extensions/runner.js dist/core/extensions/types.d.ts dist/core/extensions/runner.d.ts dist/core/extensions/index.d.ts dist/index.d.ts dist/core/agent-session.js dist/core/agent-session.d.ts dist/core/nested-tool-calls.js dist/core/nested-tool-calls.d.ts node_modules/@earendil-works/pi-agent-core/dist/agent-loop.d.ts node_modules/@earendil-works/pi-agent-core/dist/types.d.ts dist/bundle/chunks/chunk-H33F2TZD.js)
mkdir -p "$package"
cp "$original/package.json" "$package/package.json"
mkdir -p "$package/node_modules/@earendil-works/pi-agent-core"
cp "$original/node_modules/@earendil-works/pi-agent-core/package.json" "$package/node_modules/@earendil-works/pi-agent-core/package.json"
for file in "${files[@]}" dist/bundle/chunks/chunk-64GOPQSC.js; do
  mkdir -p "$package/$(dirname "$file")"
  cp -p "$original/$file" "$package/$file"
done
fingerprint() { for file in "${files[@]}"; do printf '%s %s\n' "$(pi_completion_hash "$package/$file")" "$package/$file"; done; }
fingerprint > "$work/original.hashes"
# Installations can live below an unrelated Git root, including a tracked HOME.
# git apply must patch the staging directory rather than skip its relative paths.
git init -q "$work"
# Hide shasum completely, rather than merely shadowing it with a failing shim.
sha256sum_bin="$(command -v sha256sum || true)"
bash_bin="$(command -v bash)"
if [[ -n "$sha256sum_bin" ]]; then
  minimal_path="$work/sha256sum-only"
  mkdir "$minimal_path"
  for tool in dirname jq awk sha256sum; do ln -s "$(command -v "$tool")" "$minimal_path/$tool"; done
  PATH="$minimal_path" "$bash_bin" -c 'if command -v shasum; then exit 1; fi; command -v sha256sum' > "$work/sha256sum-only-tools.log"
  if PATH="$minimal_path" "$bash_bin" "$repo/pi/rpc-readiness.sh" "$package" --check > "$work/sha256sum-only-refusal.log" 2>&1; then
    echo 'Unpatched runtime passed sha256sum-only check' >&2; exit 1
  fi
  grep -q 'readiness is absent' "$work/sha256sum-only-refusal.log"
else
  echo 'SKIP sha256sum-only PATH fixture: no sha256sum executable installed'
fi
expect_refusal() {
  if bash "$repo/pi/rpc-readiness.sh" "$package" "$1" > "$work/$2.log" 2>&1; then echo "Unexpected success: $2" >&2; exit 1; fi
}
expect_refusal --check unpatched
# The supported launcher must refuse BEFORE exec, not trust unknown event names.
if bash "$repo/pi/rpc-readiness.sh" "$package" --check > "$work/launch-refusal.log" 2>&1; then touch "$work/launched"; fi
[[ ! -e "$work/launched" ]]
fingerprint > "$work/after-check.hashes"
cmp "$work/original.hashes" "$work/after-check.hashes"
sibling_before="$(pi_completion_hash "$package/dist/bundle/chunks/chunk-64GOPQSC.js")"
bash "$repo/pi/rpc-readiness.sh" "$package" > "$work/apply.log"
fingerprint > "$work/patched.hashes"
bash "$repo/pi/rpc-readiness.sh" "$package" --check > "$work/check.log"
if [[ -n "$sha256sum_bin" ]]; then
  PATH="$minimal_path" "$bash_bin" "$repo/pi/rpc-readiness.sh" "$package" --check > "$work/sha256sum-only-check.log"
  echo 'PASS sha256sum-only PATH: shasum unavailable; unpatched refusal and patched check'
fi
bash "$repo/pi/rpc-readiness.sh" "$package" > "$work/idempotent.log"
fingerprint > "$work/repeated.hashes"
cmp "$work/patched.hashes" "$work/repeated.hashes"
[[ "$sibling_before" == "$(pi_completion_hash "$package/dist/bundle/chunks/chunk-64GOPQSC.js")" ]]
# Pi 1.0.4 completion lives in a different chunk. Its verifier still accepts
# the private runtime, both before and after our patch. render-width supports
# only older runtime versions, which this readiness helper explicitly refuses.
pi_patch_completion_bundle "$package" global "$repo/pi/patches/path-completion-bundle.json" > "$work/composition.log" 2>&1
bash "$repo/pi/rpc-readiness.sh" "$package" --check >> "$work/composition.log"
cp "$package/dist/core/extensions/runner.js" "$work/patched-runner.js"
printf '\n// unknown local modification\n' >> "$package/dist/core/extensions/runner.js"
fingerprint > "$work/unknown-before.hashes"
expect_refusal --check unknown-check
expect_refusal --apply unknown-apply
fingerprint > "$work/unknown-after.hashes"
cmp "$work/unknown-before.hashes" "$work/unknown-after.hashes"
cp "$original/dist/core/extensions/runner.js" "$package/dist/core/extensions/runner.js"
fingerprint > "$work/mixed-before.hashes"
expect_refusal --check mixed-check
expect_refusal --apply mixed-apply
fingerprint > "$work/mixed-after.hashes"
cmp "$work/mixed-before.hashes" "$work/mixed-after.hashes"
cp "$work/patched-runner.js" "$package/dist/core/extensions/runner.js"
core=node_modules/@earendil-works/pi-agent-core
mv "$package/$core" "$work/private-core"
cp -R "$work/private-core" "$work/outside-core"
for file in agent-loop.d.ts types.d.ts; do pi_completion_hash "$work/outside-core/dist/$file"; done > "$work/symlink-before.hashes"
ln -s "$work/outside-core" "$package/$core"
expect_refusal --check symlink-check
expect_refusal --apply symlink-apply
for file in agent-loop.d.ts types.d.ts; do pi_completion_hash "$work/outside-core/dist/$file"; done > "$work/symlink-after.hashes"
cmp "$work/symlink-before.hashes" "$work/symlink-after.hashes"
rm "$package/$core"
mv "$work/private-core" "$package/$core"
cp "$package/$core/package.json" "$work/core-package.json"
jq '.name="untrusted-core"' "$package/$core/package.json" > "$work/wrong-core.json"
mv "$work/wrong-core.json" "$package/$core/package.json"
expect_refusal --check dependency-identity
cp "$work/core-package.json" "$package/$core/package.json"
jq '.version="0.85.1"' "$package/package.json" > "$work/unsupported.json"
mv "$work/unsupported.json" "$package/package.json"
expect_refusal --check unsupported-check
expect_refusal --apply unsupported-apply
fingerprint > "$work/unsupported-after.hashes"
cmp "$work/patched.hashes" "$work/unsupported-after.hashes"
echo 'PASS read-only --check, launch refusal, apply/idempotence, completion composition, unknown/mixed/version refusal without mutation'

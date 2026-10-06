#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/render-width.sh"
package="${1:-$repo/pi/node_modules/@earendil-works/pi-coding-agent}"
package="$(cd -- "$package" && pwd)"
umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-width-proof.XXXXXX")"
trap 'printf "Width proof artifacts: %s\n" "$work"' EXIT
mkdir -p "$work/package/dist"
cp "$package/package.json" "$work/package/"
cp -R "$package/dist/bundle" "$work/package/dist/"
if [[ -d "$package/node_modules" ]]; then ln -s "$package/node_modules" "$work/package/node_modules";
else ln -s "$repo/pi/node_modules" "$work/package/node_modules"; fi
case "$(jq -r .version "$package/package.json")" in
  0.85.1) chunk=chunk-JVUZSMYM.js ;;
  0.87.0) chunk=chunk-4DKZACXI.js ;;
  *) echo 'Unsupported fixture version' >&2; exit 1 ;;
esac
file="$work/package/dist/bundle/chunks/$chunk"
patch_file="$repo/pi/patches/render-width-bundle.json"
# Recover the pre-width-patch control when the installed package is already fixed.
jq -jn --rawfile code "$file" --slurpfile edits "$patch_file" '
  $edits[0][0] as $edit | $code|split($edit.new) as $parts |
  if ($parts|length)==2 then $parts|join($edit.old) else $code end' > "$work/control.js"
cp "$work/control.js" "$file"
pi_patch_completion_bundle "$work/package" global "$repo/pi/patches/path-completion-bundle.json"
cp "$file" "$work/original.js"
# A malformed transformation must leave the original bundle intact.
printf '[]\n' > "$work/bad.json"
if pi_patch_render_width_bundle "$work/package" "$work/bad.json"; then echo 'Accepted missing edit' >&2; exit 1; fi
cmp "$file" "$work/original.js"
pi_patch_render_width_bundle "$work/package" "$patch_file"
cp "$file" "$work/patched.js"
pi_patch_render_width_bundle "$work/package" "$patch_file"
pi_patch_completion_bundle "$work/package" global "$repo/pi/patches/path-completion-bundle.json"
cmp "$file" "$work/patched.js"
# Test exports exist only in disposable copies, not in the deployed asset.
cp "$work/original.js" "$(dirname "$file")/width-before.js"
cp "$work/patched.js" "$(dirname "$file")/width-after.js"
printf '\nexport {visibleWidth};\n' >> "$(dirname "$file")/width-before.js"
printf '\nexport {visibleWidth};\n' >> "$(dirname "$file")/width-after.js"
node "$repo/pi/tests/render-width-fixture.mjs" "$(dirname "$file")/width-before.js" "$(dirname "$file")/width-after.js"
printf '\n// Unknown customization\n' >> "$file"
cp "$file" "$work/customized.js"
if pi_patch_render_width_bundle "$work/package" "$patch_file"; then echo 'Accepted unknown hash' >&2; exit 1; fi
cmp "$file" "$work/customized.js"
jq '.version="99.0.0"' "$work/package/package.json" > "$work/new-package.json"
mv "$work/new-package.json" "$work/package/package.json"
if pi_patch_render_width_bundle "$work/package" "$patch_file"; then echo 'Accepted unknown version' >&2; exit 1; fi
cmp "$file" "$work/customized.js"
echo 'PASS: hash/version guards, failed transformation preservation, repeat deployment and autocomplete coexistence.'

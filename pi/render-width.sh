#!/usr/bin/env bash
# Native CLI fast path: measure printable ASCII after removing terminal styling.
# Completion patches run first; hashes cover both fixes, not arbitrary local edits.
source "$(dirname -- "${BASH_SOURCE[0]}")/path-completion.sh"

pi_patch_render_width_bundle() (
  set -euo pipefail
  local package="$1" patch_file="$2" version chunk original patched file hash stage mode
  version="$(jq -er 'select(.name == "@earendil-works/pi-coding-agent") | .version' "$package/package.json")" || return 1
  case "$version" in
    0.85.1)
      chunk=chunk-JVUZSMYM.js
      original=656d3db6f8080d6906694c8371ea59c69a371826813400e3ff3516d2deec8e06
      patched=15c6274dd69a868d4b55ab47e63b70f7f0c3cf60124ad92a60d627efbee08e96 ;;
    0.87.0)
      chunk=chunk-4DKZACXI.js
      original=1ba7ad08cbad8e2dc597fc2b9dc6263dd2a4d18761b0176bf214bdfd7e52b848
      patched=11474157714a8ac77e2cfc4ea3b77f3c05d37cf3406936dd6137b7d733c829fc ;;
    *) echo "Unrecognized Pi $version; render-width patch not applied." >&2; return 1 ;;
  esac
  file="$package/dist/bundle/chunks/$chunk"
  hash="$(pi_completion_hash "$file")" || return 1
  [[ "$hash" != "$patched" ]] || return 0
  [[ "$hash" == "$original" ]] || {
    echo "Unrecognized Pi bundle hash; render-width patch not applied: $file" >&2; return 1;
  }
  stage="$(mktemp -d "$(dirname -- "$file")/.portable-render-width.XXXXXX")" || return 1
  trap 'rm -rf -- "$stage"' EXIT
  mode="$(stat -f '%Lp' "$file" 2>/dev/null)" || mode="$(stat -c '%a' "$file")" || return 1
  cp -p "$file" "$stage/editor.js" || return 1
  pi_apply_completion_edit "$stage" "$patch_file" || return 1
  [[ "$(pi_completion_hash "$stage/editor.js")" == "$patched" ]] || {
    echo 'Render-width patch output hash mismatch; installed bundle unchanged.' >&2; return 1;
  }
  chmod "$mode" "$stage/editor.js" || return 1
  [[ "$(pi_completion_hash "$file")" == "$original" ]] || return 1
  mv "$stage/editor.js" "$file" || return 1
  printf 'Patched Pi styled-text measurement: %s\n' "$file" >&2
)

pi_setup_render_width() {
  local repo="$1" cli package
  pi_patch_render_width_bundle "$repo/pi/node_modules/@earendil-works/pi-coding-agent" "$repo/pi/patches/render-width-bundle.json" || return 1
  if [[ -z "${CONFIG_PI_HOME:-}" && -n "${CONFIG_PI_COMMAND_PATH:-}" ]]; then
    source "$repo/pi/command-path.sh"
    if cli="$(pi_real_command "$CONFIG_PI_COMMAND_PATH")" && package="$(pi_completion_cli_package "$cli")" &&
       pi_patch_render_width_bundle "$package" "$repo/pi/patches/render-width-bundle.json"; then
      :
    else
      echo 'Warning: global Pi resize optimization was not applied; review its version/hash.' >&2
    fi
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  pi_setup_render_width "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fi

#!/usr/bin/env bash
# Temporary native Editor fix for the stale autocomplete menu race.
# Invoked by setup; sourceable so deployment checks can use private fixtures.
pi_completion_hash() {
  local result
  if command -v sha256sum >/dev/null; then result="$(sha256sum "$1")" || return 1; else result="$(shasum -a 256 "$1")" || return 1; fi
  printf '%s\n' "${result%% *}"
}

pi_apply_completion_edit() {
  local stage="$1" patch_file="$2"
  case "$patch_file" in
    *.json)
      cp -p "$stage/editor.js" "$stage/before.js" || return 1
      jq -jn --rawfile code "$stage/before.js" --slurpfile edits "$patch_file" '
        reduce $edits[0][] as $edit ($code;
          split($edit.old) as $parts |
          if ($parts | length) != 2 then error("Expected exactly one bundle match")
          else $parts | join($edit.new) end)
      ' > "$stage/editor.js" || return 1 ;;
    *) (cd "$stage"; git apply "$patch_file") || return 1 ;;
  esac
}

pi_patch_completion_file() (
  set -euo pipefail
  local file="$1" original="$2" previous="$3" deferred="$4" patched="$5" patch_file="$6" accept_patch="$7" focus_patch="$8" hash stage mode
  hash="$(pi_completion_hash "$file")" || return 1
  [[ "$hash" != "$patched" ]] || return 0
  if [[ "$hash" != "$original" && "$hash" != "$previous" && "$hash" != "$deferred" ]]; then
    echo "Unrecognized Pi editor hash; autocomplete patch not applied: $file" >&2; return 1
  fi
  stage="$(mktemp -d "$(dirname -- "$file")/.portable-autocomplete.XXXXXX")" || return 1
  trap 'rm -rf -- "$stage"' EXIT
  # git apply may recreate the staged file; restore its original mode before mv.
  mode="$(stat -f '%Lp' "$file" 2>/dev/null)" || mode="$(stat -c '%a' "$file")" || return 1
  cp -p "$file" "$stage/editor.js" || return 1
  # Upgrade only known original/v1/v2 assets through verified patch stages.
  # Unknown edits never enter this path.
  if [[ "$hash" == "$original" ]]; then
    pi_apply_completion_edit "$stage" "$patch_file" || return 1
    [[ "$(pi_completion_hash "$stage/editor.js")" == "$previous" ]] || {
      echo 'Autocomplete v1 patch hash mismatch; leaving installed editor untouched.' >&2; return 1;
    }
    hash="$previous"
  fi
  if [[ "$hash" == "$previous" ]]; then
    pi_apply_completion_edit "$stage" "$accept_patch" || return 1
    [[ "$(pi_completion_hash "$stage/editor.js")" == "$deferred" ]] || {
      echo 'Autocomplete v2 patch hash mismatch; leaving installed editor untouched.' >&2; return 1;
    }
  fi
  pi_apply_completion_edit "$stage" "$focus_patch" || return 1
  [[ "$(pi_completion_hash "$stage/editor.js")" == "$patched" ]] || {
    echo 'Autocomplete patch output hash mismatch; leaving installed editor untouched.' >&2; return 1;
  }
  chmod "$mode" "$stage/editor.js" || return 1
  mv "$stage/editor.js" "$file" || return 1
  printf 'Patched Pi autocomplete acceptance: %s\n' "$file" >&2
)

pi_patch_completion() {
  local package="$1" policy="$2" patch_file="$3" version original previous deferred patched
  version="$(jq -er 'select(.name == "@earendil-works/pi-tui") | .version' "$package/package.json")" || {
    echo "Cannot identify pi-tui at $package" >&2; return 1;
  }
  case "$version" in
    0.85.1)
      original=9c0d4a853d30a77040319e245d474e02afebebde960161d3bc27b6081620db27
      previous=7c1edffe5e5086034bcc26001530f039d6006e0269d108a74358bc92bef742a6
      deferred=f0f944b4739421f4be678adf582dda73ab13f7c62e83fef3410e57a7f0abf65f
      patched=f1187657e350912ace0e4a3279d405b5b93624ac35e62a028521baf7065cfc79 ;;
    0.87.0)
      original=e6efdddb40ccf924616d1e61666c394ccd36d1db49e3a0fb11d555d81cf972a8
      previous=01f5961df23a0caf5b26fd7f03072f1fb2cb9d5c3ab5587ed88e9a73d9506690
      deferred=f8a3fb47a56130b62b0c2ca0be6290276ca833a2c6ab1e8f6aa575fbdf1cac75
      patched=692bac8865aff28b246a7f91c064be13ccee2d90a9ac1e8faff481554cc7b927 ;;
    *) echo "Unrecognized pi-tui $version; autocomplete patch not applied: $package" >&2; return 1 ;;
  esac
  if [[ "$policy" == pinned && "$version" != 0.85.1 ]]; then
    echo "Pinned pi-tui version changed; review autocomplete patch: $package" >&2; return 1
  fi
  pi_patch_completion_file "$package/dist/components/editor.js" "$original" "$previous" "$deferred" "$patched" "$patch_file" \
    "$(dirname -- "$patch_file")/path-completion-accept.patch" "$(dirname -- "$patch_file")/path-completion-focus.patch"
}

pi_patch_completion_bundle() {
  local package="$1" policy="$2" patch_file="$3" version chunk original previous deferred patched
  version="$(jq -er 'select(.name == "@earendil-works/pi-coding-agent") | .version' "$package/package.json")" || {
    echo "Cannot identify Pi bundle at $package" >&2; return 1;
  }
  case "$version" in
    0.85.1)
      chunk=chunk-JVUZSMYM.js
      original=3d8b2dec97ff9fe4cabef1c69899b00cb8257c625fb0f66c52f4d9914a6b4232
      previous=d0b3a89c146f56473281c547a18860c88f8c30c441bbb519d8f0fd965ff2c06b
      deferred=03c79f7d6762c0e9d05d253350655d03d2157df39d7a5ee0bde7fa370aeaa72b
      patched=656d3db6f8080d6906694c8371ea59c69a371826813400e3ff3516d2deec8e06 ;;
    0.87.0)
      chunk=chunk-4DKZACXI.js
      original=2b60c86e356ef338ab1cea32b63f8f01e8d8d3bb7f14342fcc876a8d9a8b5505
      previous=79024e5dadb6103025c4962c5d858425f0634893bdf2200ebe388f9591488ddd
      deferred=a556403f07e83482e6ec7b6edd4b7b1b881c7e2de7a6b1649618302a495b3726
      patched=1ba7ad08cbad8e2dc597fc2b9dc6263dd2a4d18761b0176bf214bdfd7e52b848 ;;
    *) echo "Unrecognized Pi bundle $version; autocomplete patch not applied: $package" >&2; return 1 ;;
  esac
  if [[ "$policy" == pinned && "$version" != 0.85.1 ]]; then
    echo "Pinned Pi version changed; review autocomplete patch: $package" >&2; return 1
  fi
  pi_patch_completion_file "$package/dist/bundle/chunks/$chunk" "$original" "$previous" "$deferred" "$patched" "$patch_file" \
    "$(dirname -- "$patch_file")/path-completion-bundle-accept.json" "$(dirname -- "$patch_file")/path-completion-bundle-focus.json"
}

pi_completion_package() {
  local entry
  # Use Node's own resolver: the CLI and extensions may resolve different TUI copies.
  entry="$(node -p 'require.resolve("@earendil-works/pi-tui", {paths: [process.argv[1]]})' "$1")" || return 1
  (cd -- "$(dirname -- "$entry")/.." && pwd -P)
}

pi_completion_cli_package() {
  case "$1" in
    */dist/bundle/cli.js) printf '%s\n' "${1%/dist/bundle/cli.js}" ;;
    */dist/cli.js) printf '%s\n' "${1%/dist/cli.js}" ;;
    *) echo "Unrecognized Pi CLI layout: $1" >&2; return 1 ;;
  esac
}

pi_setup_completion() {
  local repo="$1" package cli root
  pi_patch_completion_bundle "$repo/pi/node_modules/@earendil-works/pi-coding-agent" pinned "$repo/pi/patches/path-completion-bundle.json" || return 1
  for root in "$repo/pi" "$repo/pi/node_modules/@earendil-works/pi-coding-agent"; do
    package="$(pi_completion_package "$root")" || return 1
    pi_patch_completion "$package" pinned "$repo/pi/patches/path-completion.patch" || return 1
  done
  # Respect isolated deployments and the CLI captured before bootstrap changes PATH.
  if [[ -z "${CONFIG_PI_HOME:-}" && -n "${CONFIG_PI_COMMAND_PATH:-}" ]]; then
    source "$repo/pi/command-path.sh"
    if cli="$(pi_real_command "$CONFIG_PI_COMMAND_PATH" 2>/dev/null)" &&
       root="$(pi_completion_cli_package "$cli")" &&
       pi_patch_completion_bundle "$root" global "$repo/pi/patches/path-completion-bundle.json" &&
       package="$(pi_completion_package "$(dirname -- "$cli")" 2>/dev/null)" &&
       pi_patch_completion "$package" global "$repo/pi/patches/path-completion.patch"; then
      :
    else
      echo 'Warning: active global Pi autocomplete fix is incomplete; unrecognized assets left untouched. Review the version/hash before adding support.' >&2
    fi
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  pi_setup_completion "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fi

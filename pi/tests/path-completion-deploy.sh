#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo/pi/path-completion.sh"
umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-path-deploy.XXXXXX")"
trap 'printf "Deployment proof artifacts: %s\n" "$work"' EXIT
patch_file="$repo/pi/patches/path-completion.patch"
bundle_patch="$repo/pi/patches/path-completion-bundle.json"
accept_patch="$repo/pi/patches/path-completion-accept.patch"
bundle_accept="$repo/pi/patches/path-completion-bundle-accept.json"
focus_patch="$repo/pi/patches/path-completion-focus.patch"
bundle_focus="$repo/pi/patches/path-completion-bundle-focus.json"
jq -s '.[0]+.[1]' "$bundle_accept" "$bundle_patch" > "$work/bundle-undo.json"
jq -s '.[0]+.[1]+.[2]' "$bundle_focus" "$bundle_accept" "$bundle_patch" > "$work/bundle-undo-v3.json"
jq -s '.[0]+.[1]' "$bundle_focus" "$bundle_accept" > "$work/bundle-to-v1.json"
mode644() { [[ "$(LC_ALL=C ls -ld "$1")" == '-rw-r--r--'* ]]; }
fixture() {
  local target="$1" source="$2" version="$3" hash
  mkdir -p "$target/dist/components"
  jq -n --arg version "$version" '{name:"@earendil-works/pi-tui",version:$version,main:"dist/index.js"}' > "$target/package.json"
  : > "$target/dist/index.js"
  cp "$source/dist/components/editor.js" "$target/dist/components/editor.js"
  hash="$(pi_completion_hash "$target/dist/components/editor.js")"
  case "$hash" in
    f1187657e350912ace0e4a3279d405b5b93624ac35e62a028521baf7065cfc79|692bac8865aff28b246a7f91c064be13ccee2d90a9ac1e8faff481554cc7b927|407110f0f1cf216832f494200b5ae9ad295e582ef7f8f0a1b89f1dc5bf124f8e)
      (cd "$target/dist/components"; git apply -R "$focus_patch")
      hash="$(pi_completion_hash "$target/dist/components/editor.js")" ;;
  esac
  case "$hash" in
    f0f944b4739421f4be678adf582dda73ab13f7c62e83fef3410e57a7f0abf65f|f8a3fb47a56130b62b0c2ca0be6290276ca833a2c6ab1e8f6aa575fbdf1cac75|1eef2f12363e3137eaa358307ec8943b333dd48b196a77cc1338b7348a40141b)
      (cd "$target/dist/components"; git apply -R "$accept_patch")
      hash="$(pi_completion_hash "$target/dist/components/editor.js")" ;;
  esac
  case "$hash" in
    7c1edffe5e5086034bcc26001530f039d6006e0269d108a74358bc92bef742a6|01f5961df23a0caf5b26fd7f03072f1fb2cb9d5c3ab5587ed88e9a73d9506690|7f1876c9931b3063bc1c1d0afe762db6c9b3d0bee2926c05e6015d8541937a25)
      (cd "$target/dist/components"; git apply -R "$patch_file") ;;
  esac
  chmod 644 "$target/dist/components/editor.js"
}
bundle_fixture() {
  local target="$1" source="$2" version="$3" source_version chunk hash undo
  source_version="$(jq -r .version "$source/package.json")"
  case "$source_version" in
    0.85.1) chunk=chunk-JVUZSMYM.js ;;
    0.87.0) chunk=chunk-4DKZACXI.js ;;
    1.0.4) chunk=chunk-64GOPQSC.js ;;
    *) return 1 ;;
  esac
  mkdir -p "$target/dist/bundle/chunks"
  jq -n --arg version "$version" '{name:"@earendil-works/pi-coding-agent",version:$version}' > "$target/package.json"
  printf '#!/usr/bin/env node\n' > "$target/dist/bundle/cli.js"
  chmod +x "$target/dist/bundle/cli.js"
  cp "$source/dist/bundle/chunks/$chunk" "$target/dist/bundle/chunks/$chunk"
  hash="$(pi_completion_hash "$target/dist/bundle/chunks/$chunk")"
  case "$hash" in
    15c6274dd69a868d4b55ab47e63b70f7f0c3cf60124ad92a60d627efbee08e96|11474157714a8ac77e2cfc4ea3b77f3c05d37cf3406936dd6137b7d733c829fc)
      jq -jn --rawfile code "$target/dist/bundle/chunks/$chunk" --slurpfile edits "$repo/pi/patches/render-width-bundle.json" '
        reduce $edits[0][] as $edit ($code; split($edit.new) as $parts |
          if ($parts|length)!=2 then error("Expected render-width match") else $parts|join($edit.old) end)
      ' > "$work/without-width.js"
      cp "$work/without-width.js" "$target/dist/bundle/chunks/$chunk"
      hash="$(pi_completion_hash "$target/dist/bundle/chunks/$chunk")" ;;
  esac
  undo="$bundle_patch"
  case "$hash" in
    03c79f7d6762c0e9d05d253350655d03d2157df39d7a5ee0bde7fa370aeaa72b|a556403f07e83482e6ec7b6edd4b7b1b881c7e2de7a6b1649618302a495b3726|add402ba4a738ea22f60a84fc02063ea3c72b66579ddc124895ad9a948bfb053) undo="$work/bundle-undo.json" ;;
    656d3db6f8080d6906694c8371ea59c69a371826813400e3ff3516d2deec8e06|1ba7ad08cbad8e2dc597fc2b9dc6263dd2a4d18761b0176bf214bdfd7e52b848|37acc8508d5daf27dd5f934cf7996383dc9a58d09ab89d93c81cc89c74c291de) undo="$work/bundle-undo-v3.json" ;;
  esac
  case "$hash" in
    d0b3a89c146f56473281c547a18860c88f8c30c441bbb519d8f0fd965ff2c06b|79024e5dadb6103025c4962c5d858425f0634893bdf2200ebe388f9591488ddd|03c79f7d6762c0e9d05d253350655d03d2157df39d7a5ee0bde7fa370aeaa72b|a556403f07e83482e6ec7b6edd4b7b1b881c7e2de7a6b1649618302a495b3726|656d3db6f8080d6906694c8371ea59c69a371826813400e3ff3516d2deec8e06|1ba7ad08cbad8e2dc597fc2b9dc6263dd2a4d18761b0176bf214bdfd7e52b848|d0713a5130329acf48a2bba05f8ad66e7642013684678a425854df340fb710f4|add402ba4a738ea22f60a84fc02063ea3c72b66579ddc124895ad9a948bfb053|37acc8508d5daf27dd5f934cf7996383dc9a58d09ab89d93c81cc89c74c291de)
      cp "$target/dist/bundle/chunks/$chunk" "$work/bundle-before-undo.js"
      jq -jn --rawfile code "$work/bundle-before-undo.js" --slurpfile edits "$undo" '
        reduce $edits[0][] as $edit ($code;
          split($edit.new) as $parts |
          if ($parts|length)!=2 then error("Expected one patched bundle match") else $parts|join($edit.old) end)
      ' > "$target/dist/bundle/chunks/$chunk" ;;
    *) : ;;
  esac
  chmod 644 "$target/dist/bundle/chunks/$chunk"
}
source_core="$repo/pi/node_modules/@earendil-works/pi-coding-agent"
source_package="$(pi_completion_package "$repo/pi")"
pinned="$work/repo/pi/node_modules/@earendil-works/pi-tui"
pinned_core="$work/repo/pi/node_modules/@earendil-works/pi-coding-agent"
fixture "$pinned" "$source_package" 0.85.1
bundle_fixture "$pinned_core" "$source_core" 0.85.1
mkdir -p "$work/repo/pi/patches"
cp "$patch_file" "$bundle_patch" "$accept_patch" "$bundle_accept" "$focus_patch" "$bundle_focus" "$work/repo/pi/patches/"
cp "$repo/pi/command-path.sh" "$work/repo/pi/"
printf 'not a patch\n' > "$work/invalid.patch"
original="$(pi_completion_hash "$pinned/dist/components/editor.js")"
if pi_patch_completion "$pinned" pinned "$work/invalid.patch" > "$work/invalid-patch.log" 2>&1; then exit 1; fi
[[ "$original" == "$(pi_completion_hash "$pinned/dist/components/editor.js")" ]]
[[ -z "$(find "$pinned" -name '.portable-autocomplete.*' -print)" ]]
pi_patch_completion "$pinned" pinned "$patch_file"
first="$(pi_completion_hash "$pinned/dist/components/editor.js")"
mode644 "$pinned/dist/components/editor.js"
pi_patch_completion "$pinned" pinned "$patch_file"
[[ "$first" == "$(pi_completion_hash "$pinned/dist/components/editor.js")" ]]
mode644 "$pinned/dist/components/editor.js"
fixture "$pinned" "$source_package" 0.85.1
pi_apply_completion_edit "$pinned/dist/components" "$patch_file"
chmod 644 "$pinned/dist/components/editor.js"
[[ "$(pi_completion_hash "$pinned/dist/components/editor.js")" == 7c1edffe5e5086034bcc26001530f039d6006e0269d108a74358bc92bef742a6 ]]
pi_patch_completion "$pinned" pinned "$patch_file"
[[ "$first" == "$(pi_completion_hash "$pinned/dist/components/editor.js")" ]]
mode644 "$pinned/dist/components/editor.js"
printf '\n// unknown edit\n' >> "$pinned/dist/components/editor.js"
unknown="$(pi_completion_hash "$pinned/dist/components/editor.js")"
if pi_patch_completion "$pinned" pinned "$patch_file" > "$work/pinned-unknown.log" 2>&1; then exit 1; fi
[[ "$unknown" == "$(pi_completion_hash "$pinned/dist/components/editor.js")" ]]
fixture "$pinned" "$source_package" 0.85.1
# The active bundled CLI is discovered from its executable, not npm's prefix.
global="$work/global/node_modules/@earendil-works/pi-coding-agent"
global_tui="$global/node_modules/@earendil-works/pi-tui"
bundle_fixture "$global" "$source_core" 9.9.9
fixture "$global_tui" "$source_package" 9.9.9
export CONFIG_PI_COMMAND_PATH="$global/dist/bundle/cli.js"
unset CONFIG_PI_HOME
unknown="$(pi_completion_hash "$global_tui/dist/components/editor.js")"
pi_setup_completion "$work/repo" 2> "$work/global-unknown-version.log"
grep -q 'Warning: active global Pi' "$work/global-unknown-version.log"
[[ "$unknown" == "$(pi_completion_hash "$global_tui/dist/components/editor.js")" ]]
mode644 "$pinned_core/dist/bundle/chunks/chunk-JVUZSMYM.js"
# A supported version with changed bundle code is also left untouched.
bundle_fixture "$global" "$source_core" 0.85.1
printf '\n// unknown edit\n' >> "$global/dist/bundle/chunks/chunk-JVUZSMYM.js"
unknown_bundle="$(pi_completion_hash "$global/dist/bundle/chunks/chunk-JVUZSMYM.js")"
pi_setup_completion "$work/repo" 2> "$work/global-unknown-hash.log"
grep -q 'Unrecognized Pi editor hash' "$work/global-unknown-hash.log"
[[ "$unknown_bundle" == "$(pi_completion_hash "$global/dist/bundle/chunks/chunk-JVUZSMYM.js")" ]]
[[ "$unknown" == "$(pi_completion_hash "$global_tui/dist/components/editor.js")" ]]
# Isolated deployments skip the global CLI entirely.
CONFIG_PI_HOME="$work/isolated" pi_setup_completion "$work/repo" 2> "$work/isolated.log"
[[ ! -s "$work/isolated.log" ]]
# Strict bundle handling must fail without rewriting unrecognized code.
printf '\n// unknown edit\n' >> "$pinned_core/dist/bundle/chunks/chunk-JVUZSMYM.js"
unknown_bundle="$(pi_completion_hash "$pinned_core/dist/bundle/chunks/chunk-JVUZSMYM.js")"
if CONFIG_PI_HOME="$work/isolated" pi_setup_completion "$work/repo" 2> "$work/pinned-bundle-unknown.log"; then exit 1; fi
[[ "$unknown_bundle" == "$(pi_completion_hash "$pinned_core/dist/bundle/chunks/chunk-JVUZSMYM.js")" ]]
bundle_fixture "$pinned_core" "$source_core" 0.85.1
# Exercise the actual supported global source without modifying it here.
source "$repo/pi/command-path.sh"
if actual_cli="$(pi_real_command "$(command -v pi)")" && actual_core="$(pi_completion_cli_package "$actual_cli")" &&
   actual_package="$(pi_completion_package "$(dirname -- "$actual_cli")")" &&
   actual_version="$(jq -r .version "$actual_core/package.json")" &&
   [[ "$actual_version" == 0.87.0 || "$actual_version" == 1.0.4 ]]; then
  case "$actual_version" in
    0.87.0)
      chunk=chunk-4DKZACXI.js
      native_v3=692bac8865aff28b246a7f91c064be13ccee2d90a9ac1e8faff481554cc7b927
      bundle_v3=1ba7ad08cbad8e2dc597fc2b9dc6263dd2a4d18761b0176bf214bdfd7e52b848
      native_v2=f8a3fb47a56130b62b0c2ca0be6290276ca833a2c6ab1e8f6aa575fbdf1cac75
      bundle_v2=a556403f07e83482e6ec7b6edd4b7b1b881c7e2de7a6b1649618302a495b3726 ;;
    1.0.4)
      chunk=chunk-64GOPQSC.js
      native_v3=407110f0f1cf216832f494200b5ae9ad295e582ef7f8f0a1b89f1dc5bf124f8e
      bundle_v3=37acc8508d5daf27dd5f934cf7996383dc9a58d09ab89d93c81cc89c74c291de
      native_v2=1eef2f12363e3137eaa358307ec8943b333dd48b196a77cc1338b7348a40141b
      bundle_v2=add402ba4a738ea22f60a84fc02063ea3c72b66579ddc124895ad9a948bfb053 ;;
  esac
  bundle_fixture "$global" "$actual_core" "$actual_version"
  fixture "$global_tui" "$actual_package" "$actual_version"
  native_file="$global_tui/dist/components/editor.js"
  bundle_file="$global/dist/bundle/chunks/$chunk"
  original_native="$(pi_completion_hash "$native_file")"
  original_bundle="$(pi_completion_hash "$bundle_file")"
  for state in original v1 v2 v3; do
    case "$state" in
      v1|v2)
        (cd "$global_tui/dist/components"; git apply -R "$focus_patch")
        undo="$bundle_focus"
        if [[ "$state" == v1 ]]; then
          (cd "$global_tui/dist/components"; git apply -R "$accept_patch")
          undo="$work/bundle-to-v1.json"
        fi
        jq -jn --rawfile code "$bundle_file" --slurpfile edits "$undo" '
          reduce $edits[0][] as $edit ($code; split($edit.new) as $parts |
            if ($parts|length)!=2 then error("Expected migration match") else $parts|join($edit.old) end)
        ' > "$work/migration-bundle.js"
        mv "$work/migration-bundle.js" "$bundle_file"
        chmod 644 "$native_file" "$bundle_file" ;;
    esac
    if [[ "$state" == v2 ]]; then
      [[ "$(pi_completion_hash "$native_file")" == "$native_v2" ]]
      [[ "$(pi_completion_hash "$bundle_file")" == "$bundle_v2" ]]
    fi
    # Each deployed state must also be reversible to the original fixture.
    fixture "$work/reversed-tui" "$global_tui" "$actual_version"
    bundle_fixture "$work/reversed-core" "$global" "$actual_version"
    [[ "$(pi_completion_hash "$work/reversed-tui/dist/components/editor.js")" == "$original_native" ]]
    [[ "$(pi_completion_hash "$work/reversed-core/dist/bundle/chunks/$chunk")" == "$original_bundle" ]]
    pi_setup_completion "$work/repo" 2> "$work/global-$state.log"
    [[ "$(pi_completion_hash "$native_file")" == "$native_v3" ]]
    [[ "$(pi_completion_hash "$bundle_file")" == "$bundle_v3" ]]
    mode644 "$native_file"
    mode644 "$bundle_file"
    if [[ "$state" == v3 ]]; then [[ ! -s "$work/global-$state.log" ]]; fi
  done
  # Unknown native and bundle edits on this supported version fail closed.
  for file in "$native_file" "$bundle_file"; do
    cp "$file" "$work/known.js"
    printf '\n// unknown edit\n' >> "$file"
    unknown="$(pi_completion_hash "$file")"
    pi_setup_completion "$work/repo" 2> "$work/global-$actual_version-unknown-$(basename "$file").log"
    grep -q 'Unrecognized Pi editor hash' "$work/global-$actual_version-unknown-$(basename "$file").log"
    [[ "$(pi_completion_hash "$file")" == "$unknown" ]]
    mode644 "$file"
    cp "$work/known.js" "$file"
  done
  printf 'PASS: active global Pi %s original/v1/v2/v3, reverse fixtures, unknown hashes\n' "$actual_version"
else
  echo 'SKIP: no active global Pi 0.87.0 or 1.0.4 source available'
fi
printf 'PASS: native/bundle original-v1-v2-v3 hashes, atomic failures, idempotence, mode 0644 under umask 077, global warnings, isolation\n'

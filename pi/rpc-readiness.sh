#!/usr/bin/env bash
# Repo-owned Pi 1.0.4 RPC readiness patch. Setup integration is explicit: this
# helper never discovers or modifies an installation unless given its directory.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${2:---apply}"
[[ "$mode" == --apply || "$mode" == --check || "$mode" == --check-json ]] || { echo "Unknown RPC readiness operation: $mode" >&2; exit 1; }
state=unknown reason=observation_error version='' manifest_id='' assets='[]'
package="${1:?Usage: rpc-readiness.sh PACKAGE_DIRECTORY [--check | --check-json]}"
hash() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'
}
if [[ "$mode" == --check-json ]]; then
  checker_id="$(hash "${BASH_SOURCE[0]}")"
  exec 3>&1 1>&2
  report() {
    status=$?
    trap - EXIT
    jq -n --arg state "$state" --arg reason "$reason" --arg package "$package" \
      --arg version "$version" --arg checker "$checker_id" --arg manifest "$manifest_id" \
      --argjson assets "$assets" \
      '{schema:1,state:$state,reason:$reason,package:$package,version:$version,
        checker_sha256:$checker,manifest_sha256:$manifest,assets:$assets}' >&3 || exit 2
    exit "$status"
  }
  trap report EXIT
fi
refuse() { state=failed; reason="$1"; shift; echo "$*" >&2; exit 1; }
[[ -d "$package" ]] || refuse missing_package 'Pi package directory is absent.'
package="$(cd -- "$package" && pwd -P)"
safe_asset() {
  local file="$1" part current="$package"
  local pieces=()
  [[ -n "$file" && "$file" != /* ]] || refuse unsafe_path "Unsafe RPC patch path: $file"
  IFS=/ read -r -a pieces <<< "$file"
  for part in "${pieces[@]}"; do
    [[ -n "$part" && "$part" != . && "$part" != .. ]] || refuse unsafe_path "Unsafe RPC patch path: $file"
    current="$current/$part"
    [[ ! -L "$current" ]] || refuse symlink "Refusing RPC patch asset through symlink: $current"
  done
}
safe_asset package.json
[[ -f "$package/package.json" ]] || refuse missing_identity 'Pi package identity is absent.'
[[ -r "$package/package.json" ]] || exit 2
# A mismatch is data from a successful observation, never a jq exit status.
identity_matches="$(jq -r 'type == "object" and .name == "@earendil-works/pi-coding-agent"' "$package/package.json")" || exit 2
case "$identity_matches" in
  true) ;;
  false) refuse invalid_identity 'Invalid Pi package identity.' ;;
  *) exit 2 ;;
esac
version="$(jq -r '.version // empty' "$package/package.json")" || exit 2
[[ "$version" == 1.0.4 ]] || refuse unsupported_version "Unsupported Pi runtime $version: RPC readiness was NOT installed."
safe_asset node_modules/@earendil-works/pi-agent-core/package.json
[[ -e "$package/node_modules/@earendil-works/pi-agent-core/package.json" ]] || refuse missing_identity 'Pi core package identity is absent.'
[[ -r "$package/node_modules/@earendil-works/pi-agent-core/package.json" ]] || exit 2
identity_matches="$(jq -r 'type == "object" and .name == "@earendil-works/pi-agent-core" and .version == "1.0.4"' "$package/node_modules/@earendil-works/pi-agent-core/package.json")" || exit 2
case "$identity_matches" in
  true) ;;
  false) refuse unsupported_core 'Unsupported pi-agent-core identity/version; RPC readiness was NOT installed.' ;;
  *) exit 2 ;;
esac
# Code constants, not configuration. Every asset must be one complete known state.
manifest='dist/modes/rpc/rpc-mode.js 631697cd35928fc827f4a423538c43ff227b8cbf63c2a2f11060616f55eba6db 2c94d4f9199a43727549e05340bb470187bbfb88eb5cf1064b5cce937222db26
dist/core/extensions/runner.js 258f142bc56cc84d953ef6146222e5ff3a94cc908592a1b3d075d34bbcd68b36 1e3c4d77b26ed992fc7e52345cb72149ea151d7a13e0406916ec5b9a9ba651a0
dist/core/extensions/types.d.ts 5e43b8423ee2454959b987007292fd1514fe168dbe58a04d9b9d951b10bf2123 5bc29e42bea796655a952ef8f10ee11a477e94b343557c3633dd58c330728836
dist/core/extensions/runner.d.ts 6aef77e094e73abd7e508850e45c58e244ab2d5db6c4f6278d8652ea9ded2bb1 e3a9d664834825d295749400c7bc25a1fea36a93d60cedfc944951bd946ee878
dist/core/extensions/index.d.ts fe5661c6cd9a948293f0f1d1db5a052dcc60493f6b1f68349a7ab96987b10e40 be234465e27bb6a5ee132ad0d92c22b56997ddbddda710c24c0beb6d21c2cca1
dist/index.d.ts b254e36846b1dcc64ce1a8ba72e23fb410df4aa4408ba8c23e69e5b3f934e3cc 2fd98e3a4d015bde403fd73ddb9442901de9156587fa40ede06a513c88a02529
dist/core/agent-session.js 9898d8a44ba68d495b0f6e78f888116a6496d7c1b5d1bb568e3028c3b1413977 cfc99c6d94c84a29876421961ce6455ec7543f39e896c09c60283d7bdd7156ec
dist/core/agent-session.d.ts 55815291e2a543ea55fbac4549874a80424c370160507ccbc70f16d5551f60a7 665393feb6084a2851b4364ccddc25dfc10931e064c4adae2755bd73c9eff2b4
dist/core/nested-tool-calls.js 4a492ada9360c4b9e8d1f7a222f1975540c65373ac31a53a6ddb4128063c5973 9ad7e1dff27c484bda9a1678bb8b41b32c04a2abaf2a6488b38bfc11e767b1c0
dist/core/nested-tool-calls.d.ts 48df2d39bf5e336253601edb8d301a6b058a0a3fd2c9e4eef6c82924c684c9b9 5728b3dc80319787e59be59debbc15bf5f06dfd0114f70a24444ee986b0d45ed
node_modules/@earendil-works/pi-agent-core/dist/agent-loop.d.ts 9ad54e11f8d74b499d3700c184919388b974fe87b81b806ee044e68b81c7e3ca 0cc4643d7e65fdf884619303fec6918be0859226b0666864cab23552581dfec1
node_modules/@earendil-works/pi-agent-core/dist/types.d.ts a4cc438f7ec8f75c2170d6190b64db0efb34904b467469d4bd719db0c9973997 f7d128320cf72d7e30d9645e04e14f31e8cab854e595d5c6ad1f00c2864a9db3
dist/bundle/chunks/chunk-H33F2TZD.js ffefe09d06cc357cade211d8123c971f0327e04f627c08f37e4e97c79da4dd11 7404b900239c89bf1ad498ca43e6d08964f26462a122a2f7bf30ed1fbf54e849'
if [[ "$mode" == --check-json ]]; then
  if command -v sha256sum >/dev/null; then
    manifest_id="$(printf '%s\n' "$manifest" | sha256sum | awk '{print $1}')"
  else
    manifest_id="$(printf '%s\n' "$manifest" | shasum -a 256 | awk '{print $1}')"
  fi
fi
original_count=0
patched_count=0
while read -r file original patched; do
  safe_asset "$file"
  [[ -f "$package/$file" ]] || refuse missing_asset "Missing Pi asset: $file"
  actual="$(hash "$package/$file")"
  if [[ "$mode" == --check-json ]]; then
    assets="$(jq -cn --argjson assets "$assets" --arg path "$file" --arg sha256 "$actual" '$assets + [{path:$path,sha256:$sha256}]')"
  fi
  case "$actual" in
    "$original") original_count=$((original_count+1)) ;;
    "$patched") patched_count=$((patched_count+1)) ;;
    *) refuse unrecognized_asset "Unrecognized Pi asset: $file. RPC readiness was NOT installed." ;;
  esac
done <<< "$manifest"
if [[ "$original_count" == 0 ]]; then state=passed; reason=verified_patched; echo 'Pi RPC readiness already installed.'; exit 0; fi
[[ "$patched_count" == 0 ]] || refuse mixed_assets 'Mixed Pi RPC readiness assets; refusing a partial installation.'
[[ "$mode" == --apply ]] || refuse unpatched_assets 'Pi RPC readiness is absent; refusing guarded RPC launch.'
stage="$(mktemp -d "$package/.rpc-readiness.XXXXXX")"
committing=false
cleanup() {
  status=$?
  if [[ "$status" != 0 && "$committing" == true ]]; then
    while read -r file original patched; do cp -p "$stage/original/$file" "$package/$file" || status=2; done <<< "$manifest"
    echo 'RPC readiness installation failed; original assets restored where possible.' >&2
  fi
  rm -rf -- "$stage"
  exit "$status"
}
trap cleanup EXIT
while read -r file original patched; do
  mkdir -p "$stage/original/$(dirname "$file")" "$stage/candidate/$(dirname "$file")"
  cp -p "$package/$file" "$stage/original/$file"
  cp -p "$package/$file" "$stage/candidate/$file"
done <<< "$manifest"
# Prevent a surrounding repository or inherited Git context from redirecting
# relative patch paths away from this verified staging directory.
(cd "$stage/candidate"; env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_PREFIX \
  GIT_CEILING_DIRECTORIES="$stage" git apply "$repo/pi/patches/rpc-readiness.patch")
chunk=dist/bundle/chunks/chunk-H33F2TZD.js
jq -jn --rawfile code "$stage/original/$chunk" --slurpfile edits "$repo/pi/patches/rpc-readiness-bundle.json" '
  reduce $edits[0][] as $edit ($code;
    split($edit.old) as $parts |
    if ($parts | length) != 2 then error("Expected exactly one RPC bundle match")
    else $parts | join($edit.new) end)
' > "$stage/candidate/$chunk"
while read -r file original patched; do
  [[ "$(hash "$stage/candidate/$file")" == "$patched" ]] || { echo "RPC readiness output hash mismatch: $file" >&2; exit 1; }
  [[ "$(hash "$package/$file")" == "$original" ]] || { echo "Pi asset changed during staging: $file" >&2; exit 1; }
done <<< "$manifest"
committing=true
while read -r file original patched; do mv "$stage/candidate/$file" "$package/$file"; done <<< "$manifest"
committing=false
printf 'Installed verified Pi RPC readiness: %s\n' "$package"

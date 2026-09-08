#!/usr/bin/env bash
# Sourced after runtime.sh; only init.sh calls the installer.
pi_jq_version=1.8.1
case "$pi_node_platform" in
  darwin-arm64) pi_jq_asset=jq-macos-arm64; pi_jq_sha=a9fe3ea2f86dfc72f6728417521ec9067b343277152b114f4e98d8cb0e263603 ;;
  darwin-x64) pi_jq_asset=jq-macos-amd64; pi_jq_sha=e80dbe0d2a2597e3c11c404f03337b981d74b4a8504b70586c354b7697a7c27f ;;
  linux-arm64) pi_jq_asset=jq-linux-arm64; pi_jq_sha=6bc62f25981328edd3cfcfe6fe51b073f2d7e7710d7ef7fcdac28d4e384fc3d4 ;;
  linux-x64) pi_jq_asset=jq-linux-amd64; pi_jq_sha=020468de7539ce70ef1bceaf7cde2e8c4f2ca6c3afb84642aabc5c97d9fc2a0d ;;
esac
pi_jq_dir="$pi_runtime_root/jq-$pi_jq_version-$pi_jq_asset"
export PATH="$pi_jq_dir:$PATH"
ensure_pi_jq() (
  set -euo pipefail
  if [[ -x "$pi_jq_dir/jq" ]] && [[ "$("$pi_jq_dir/jq" --version)" == "jq-$pi_jq_version" ]]; then
    return 0
  fi
  local stage url
  pi_stage_download
  url="https://github.com/jqlang/jq/releases/download/jq-$pi_jq_version/$pi_jq_asset"
  echo "Installing private jq $pi_jq_version ($pi_jq_asset)..." >&2
  pi_download_verified "$url" "$stage/jq" "$pi_jq_sha"
  chmod 755 "$stage/jq"
  "$stage/jq" --version >/dev/null
  mkdir -p "$pi_jq_dir"
  mv "$stage/jq" "$pi_jq_dir/jq"
)

#!/usr/bin/env bash
# Sourced by init.sh and pi.sh. Only init.sh calls the installer below.
source "$(dirname -- "${BASH_SOURCE[0]}")/bootstrap.sh"
pi_node_version=22.23.2
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) pi_node_platform=darwin-arm64; pi_node_sha=61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6 ;;
  Darwin/x86_64) pi_node_platform=darwin-x64; pi_node_sha=58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026 ;;
  Linux/aarch64|Linux/arm64) pi_node_platform=linux-arm64; pi_node_sha=013b59cfd2819703a6f4a14ab891fc46fc2a4e3f5bcd92de3fb4929b43e35b30 ;;
  Linux/x86_64) pi_node_platform=linux-x64; pi_node_sha=b294a556e639d64338823920e5866c21c02741742d2e1529ee1a225c1ec9252a ;;
  *) echo 'Portable Pi supports macOS and glibc Linux on arm64/x64.' >&2; exit 1 ;;
esac
pi_runtime_root="${CONFIG_PI_RUNTIME_DIR:-$HOME/.local/share/config-pi/runtime}"
pi_node_name="node-v$pi_node_version-$pi_node_platform"
pi_node_dir="$pi_runtime_root/$pi_node_name"
export PATH="$pi_node_dir/bin:$PATH"

ensure_pi_runtime() (
  set -euo pipefail
  if [[ -x "$pi_node_dir/bin/node" && -f "$pi_node_dir/bin/npm" ]] && \
     [[ "$("$pi_node_dir/bin/node" --version)" == "v$pi_node_version" ]]; then
    return 0
  fi
  command -v tar >/dev/null || { echo 'Bootstrap needs the OS tar utility.' >&2; exit 1; }
  local stage url
  pi_stage_download
  url="https://nodejs.org/dist/v$pi_node_version/$pi_node_name.tar.gz"
  echo "Installing private Node.js $pi_node_version ($pi_node_platform)..." >&2
  pi_download_verified "$url" "$stage/node.tar.gz" "$pi_node_sha"
  tar -xzf "$stage/node.tar.gz" -C "$stage"
  "$stage/$pi_node_name/bin/node" --version >/dev/null || {
    echo 'Node cannot run on this OS. Linux requires a supported glibc distribution (not Alpine/musl).' >&2
    exit 1
  }
  # Replace only our own versioned runtime after download and verification.
  rm -rf "$pi_node_dir"
  mv "$stage/$pi_node_name" "$pi_node_dir"
)

#!/usr/bin/env bash
# Regression: npm's prefix need not contain the active Pi CLI package.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
lab="$(mktemp -d "${TMPDIR:-/tmp}/pi-capacity-discovery.XXXXXX")"
trap 'rm -rf -- "$lab"' EXIT
mkdir "$lab/bin"
printf '#!/bin/sh\necho "npm prefix discovery must not be used" >&2\nexit 99\n' > "$lab/bin/npm"
chmod +x "$lab/bin/npm"
PATH="$lab/bin:$PATH" bash "$repo/pi/test-subagent-capacity.sh" all "${1:?Pass an already-applied package root}"

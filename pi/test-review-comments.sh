#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
proof="${1:-$(mktemp -d "${TMPDIR:-/tmp}/pi-review-comments.XXXXXX")}"
mkdir -p "$proof/workspace" "$proof/agent"
proof="$(cd "$proof" && pwd -P)"
git -C "$proof/workspace" init -q
printf 'anchor\noriginal\ntail\n' > "$proof/workspace/sample.txt"
printf 'other anchor\nother content\n' > "$proof/workspace/other.txt"
git -C "$proof/workspace" add .
git -C "$proof/workspace" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm baseline
printf 'anchor\nchanged\ntail\n' > "$proof/workspace/sample.txt"
node "$repo/pi/tests/review-comments-fixture.mjs" "$proof/workspace" "$proof/agent" "$proof" > "$proof/results.log" 2>&1 || { printf 'FAIL: inspect %s/results.log\n' "$proof" >&2; exit 1; }
bash "$repo/pi/tests/review-comments-tui.sh" "$proof/tui" > "$proof/tui.log" 2>&1 || { printf 'FAIL: inspect %s/tui.log\n' "$proof" >&2; exit 1; }
printf 'PASS: review comments. Proof: %s\n' "$proof"

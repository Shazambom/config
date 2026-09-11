#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v tmux >/dev/null || { echo 'tmux is required for the diff terminal regression test' >&2; exit 1; }
mode="${1:-check}"
case "$mode" in check|baseline) ;; *) exit 2 ;; esac
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-diff-render.XXXXXX")"
socket="$work/tmux.sock"
cleanup() { tmux -S "$socket" kill-server 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
# A private server and synthetic diff never load user extensions or credentials.
export DIFF_TEST_SOCKET="$socket"
cp -R "$repo/pi/node_modules/pi-diff-review/src" "$work/src"
ln -s "$repo/pi/node_modules" "$work/node_modules"
cp "$work/src/review/component-upstream.ts" "$work/component.ts"
if [[ -f "$work/src/index-upstream.ts" ]]; then
  cp "$work/src/index-upstream.ts" "$work/index.ts"
else
  cp "$work/src/index.ts" "$work/index.ts"
fi
(cd "$work"; git apply "$repo/pi/patches/diff-review-colors.patch")
if [[ "$mode" != baseline ]]; then
  (cd "$work"; git apply "$repo/pi/patches/diff-review-ui.patch")
fi
mv "$work/component.ts" "$work/src/review/component.ts"
mv "$work/index.ts" "$work/src/index.ts"
cp "$repo/pi/overrides/diff-ui.ts" "$work/src/diff-ui.ts"
export DIFF_TEST_COMPONENT="$work/src/review/component.ts"
printf '#!/usr/bin/env bash\ncd %q\nnode pi/tests/diff-render-fixture.mjs %q %q 2>%q\ntmux -S %q wait-for -S finished\n' "$repo" "$work/result.json" "$mode" "$work/stderr" "$socket" > "$work/run.sh"
tmux -S "$socket" -f /dev/null new-session -d -x 120 -y 35 -s fixture
# Keep the server alive after the fixture process exits.
tmux -S "$socket" set-option -g mouse on
tmux -S "$socket" set-option -g remain-on-exit on
tmux -S "$socket" respawn-pane -k -t fixture "bash '$work/run.sh'"
tmux -S "$socket" wait-for finished
if [[ -s "$work/stderr" ]]; then
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$work/stderr"
  exit 1
fi
if [[ -f "$work/result.json.error" ]]; then
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$work/result.json.error"
  exit 1
fi
jq -e '(.flags == "0 0 0" or .flags == "1 1 0") and (.measurements | length > 0)' "$work/result.json" >/dev/null
jq '{flags, actions: (.measurements | length), clears: ([.measurements[].clears] | add), forced: [.measurements[] | select(.clears > 0)]}' "$work/result.json"

#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-tmux}"; columns="${2:-122}"; rows="${3:-54}"
expanded="${4:-compact}"; mascot="${5:-plain}"
[[ $# -le 5 && "$columns" =~ ^[1-9][0-9]*$ && "$rows" =~ ^[1-9][0-9]*$ ]] || exit 2
case "$mode:$expanded:$mascot" in
  tmux:compact:plain|tmux:compact:legacy-mascot|tmux:expanded:plain|tmux:expanded:legacy-mascot|direct:compact:plain|direct:compact:legacy-mascot|direct:expanded:plain|direct:expanded:legacy-mascot) ;;
  *) echo 'Usage: pi/test-startup-render.sh [tmux|direct] [columns] [rows] [compact|expanded] [plain|legacy-mascot]'  >&2; exit 2 ;;
esac
command -v jq >/dev/null
command -v script >/dev/null
[[ "$mode" != tmux ]] || command -v tmux >/dev/null
work="$(mktemp -d "${TMPDIR:-/tmp}/pi-startup-render.XXXXXX")"
socket="$work/tmux.sock"
cleanup() {
  for pid in "${watchdog:-}" "${terminal_pid:-}"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  [[ "$mode" != tmux ]] || tmux -S "$socket" kill-server 2>/dev/null || true
  if [[ "${PI_STARTUP_KEEP:-0}" == 1 ]]; then printf 'Synthetic traces: %s\n' "$work"; else rm -rf "$work"; fi
}
trap cleanup EXIT
mkdir -p "$work/home" "$work/agent/extensions" "$work/cwd"
cp -R "$repo/pi/agent/themes" "$work/agent/themes"
ln -s "$repo/pi/node_modules" "$work/agent/node_modules"
jq --arg root "$repo/pi" --slurpfile upstream "$repo/pi/upstream.json" '
  def path:
    if startswith("../upstream/") then
      ltrimstr("../upstream/") as $name |
      ($upstream[0][] | select(.name == $name)) as $pin |
      $root + "/upstream/" + $name + "-" + $pin.ref
    else $root + ltrimstr("..") end;
  .packages |= map(if type == "string" then path else .source |= path end) |
  .["observational-memory"].enabled = false | .defaultProjectTrust = "yes" | .skills = []
' "$repo/pi/agent/settings.json" > "$work/agent/settings.json"
ln -s "$repo/pi/agent/extensions/claude-skills.ts" "$work/agent/extensions/claude-skills.ts"
if [[ "$mascot" == legacy-mascot ]]; then ln -s "$repo/pi/tests/legacy-mascot.ts" "$work/agent/extensions/mascot.ts"; fi
config="$(jq -r '.[] | select(.name == "pi-config") | .ref' "$repo/pi/upstream.json")"
for extension in browser web-search web-fetch prompt-snippets; do
  ln -s "$repo/pi/upstream/pi-config-$config/extensions/$extension/index.ts" "$work/agent/extensions/$extension.ts"
done
printf 'set -g default-shell /bin/bash\nset -g default-terminal tmux-256color\nset -as terminal-features ",xterm*:sync:RGB"\nset -g mouse on\n' > "$work/tmux.conf"
printf 'globalThis.fetch = async () => { throw new Error("Startup fixture blocks network fetch"); };\n' > "$work/offline.mjs"
tmuxvars=''
if [[ "$mode" == tmux ]]; then tmuxvars='TMUX="${TMUX:-}" TMUX_PANE="${TMUX_PANE:-}"'; fi
printf '#!/bin/bash\ncd %q\nexec env -i HOME=%q PATH=%q TERM="${TERM:-xterm-256color}" %s PI_CODING_AGENT_DIR=%q PI_OFFLINE=1 PI_STARTUP_HISTORY_LINES=%q PI_STARTUP_RESULT=%q %q --import %q %q --no-session -e %q\n' \
  "$work/cwd" "$work/home" "$PATH" "$tmuxvars" "$work/agent" "${PI_STARTUP_HISTORY_LINES:-0}" "$work/pi-writes" "$(command -v node)" "$work/offline.mjs" \
  "$repo/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" "$repo/pi/tests/startup-probe.ts" > "$work/run.sh"
if [[ "$mode" == tmux ]]; then
  printf -v command 'stty rows %q cols %q; exec tmux -S %q -f %q new-session -s fixture %q' "$rows" "$columns" "$socket" "$work/tmux.conf" "bash '$work/run.sh'"
else
  printf -v command 'stty rows %q cols %q; exec bash %q' "$rows" "$columns" "$work/run.sh"
fi
input() { sleep 2; if [[ "$expanded" == expanded ]]; then printf '\017'; fi; sleep 1; printf '/reload\r'; sleep 8; }
if [[ "$(uname -s)" == Darwin ]]; then
  input | env -i HOME="$work/home" PATH="$PATH" TERM=xterm-256color SHELL=/bin/bash script -q "$work/client.ansi" bash -c "$command" > "$work/terminal.log" 2>&1 &
else
  input | env -i HOME="$work/home" PATH="$PATH" TERM=xterm-256color SHELL=/bin/bash script -q -e -c "$command" "$work/client.ansi" > "$work/terminal.log" 2>&1 &
fi
terminal_pid=$!
(sleep 25; kill "$terminal_pid" 2>/dev/null || true) & watchdog=$!
if ! wait "$terminal_pid"; then echo 'Startup probe failed or exceeded 25 seconds. Use PI_STARTUP_KEEP=1 to retain synthetic traces.' >&2; exit 1; fi
terminal_pid=''
kill "$watchdog" 2>/dev/null || true
wait "$watchdog" 2>/dev/null || true
watchdog=''
logs=("$work"/pi-writes.*)
[[ ${#logs[@]} -eq 2 && -f "${logs[0]}" ]] || { echo 'Expected startup and reload traces; use PI_STARTUP_KEEP=1 to inspect.' >&2; exit 1; }
jq -s --arg mode "$mode" --arg size "${columns}x${rows}" --arg display "$expanded/$mascot" '{mode:$mode,size:$size,display:$display,piClearTimesMs:map([.[] | select(.data | contains("\u001b[2J")) | .time])}' "${logs[@]}"
jq -Rs '{clientScreenClears:([scan("\u001b\\[2J")]|length),clientSyncFrames:([scan("\u001b\\[\\?2026h")]|length)}' "$work/client.ansi"

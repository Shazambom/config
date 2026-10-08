#!/usr/bin/env bash
# Default is inert. --bootstrap permits GUI only; both live flags permit clipboard.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-}" in
  --help)
    printf '%s\n' 'Usage: pi/test-copy-paste-universal.sh --live-manual --replace-clipboard' \
      'Or: pi/test-copy-paste-universal.sh --native-menu --replace-clipboard [--candidate-profile]' \
      'Or: pi/test-copy-paste-universal.sh --bootstrap (GUI, no clipboard)' \
      'Default: BLOCKED (exit 77), no GUI or clipboard access.' \
      'Live mode opens an isolated iTerm2 tmux-CC window. Physical keys are manual.' \
      'WARNING: replaces the OS clipboard with synthetic fixtures. Save it yourself first.' \
      'The test NEVER saves or restores previous clipboard contents.'
    exit 0 ;;
esac
bootstrap=false
if [[ "$#" == 1 && "$1" == --bootstrap ]]; then bootstrap=true; fi
native=false
if [[ ( "$#" == 2 || ( "$#" == 3 && "$3" == --candidate-profile ) ) && "$1" == --native-menu && "$2" == --replace-clipboard ]]; then native=true; fi
if [[ "$bootstrap" == false && "$native" == false && ( "$#" != 2 || "$1" != --live-manual || "$2" != --replace-clipboard ) ]]; then
  echo 'BLOCKED: requires --live-manual --replace-clipboard; no GUI or clipboard accessed.'
  exit 77
fi
[[ "$(uname -s)" == Darwin ]] || { echo 'BLOCKED: macOS/iTerm2 required'; exit 77; }
python="$HOME/.config/portable-pi/iterm2-venv/bin/python3"
[[ -x "$python" ]] || { echo 'BLOCKED: existing iTerm2 Python environment missing; run repository setup separately'; exit 77; }
for tool in tmux node jq osascript; do
  command -v "$tool" >/dev/null || { echo "BLOCKED: missing $tool"; exit 77; }
done
if [[ "$bootstrap" == false ]]; then
  printf '%s\n' 'WARNING: this opens a test window and REPLACES your OS clipboard.' \
    'Save anything important yourself. No previous clipboard content will be read or saved.' \
    'Do not copy private text or use clipboard managers during the test.'
fi
resolved="$(bash "$repo/pi/tests/lifecycle-lab/lab.sh" resolve)"
cli="$(jq -er .cli <<< "$resolved")"
if [[ "$bootstrap" == true ]]; then
  exec "$python" "$repo/pi/tests/copy-paste-universal/journey.py" --cli "$cli" --bootstrap
fi
exec "$python" "$repo/pi/tests/copy-paste-universal/journey.py" --cli "$cli" "$@"

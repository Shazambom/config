#!/usr/bin/env bash
# Run only after the parent lifts the CLI pause and prepares a verified private bundle.
set -euo pipefail
candidate=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ $# -ne 3 ]]; then
  echo "usage: bash pi/test-task-cues.sh PRIVATE_CLI_JS EVIDENCE_DIR MODE" >&2
  exit 2
fi
cli_dir=$(cd "$(dirname "$1")" && pwd -P)
cli="$cli_dir/$(basename "$1")"
case "$cli" in "$candidate"/*) ;; *) echo 'CLI must be a prepared private candidate copy, not a launcher or installed file' >&2; exit 2 ;; esac
[[ $(basename "$cli") == cli.js && -f "$cli_dir/cli-runtime.js" ]] || { echo 'Missing actual bundled CLI/runtime' >&2; exit 2; }
expected=e79626f2dd6f94aa45d30f3fa63cd84319a6eefcd150b353cfaf274366926774
actual=$(shasum -a 256 "$cli" | awk '{print $1}')
[[ "$actual" == "$expected" ]] || { echo 'Selected CLI entry hash changed; ask the parent to verify it' >&2; exit 2; }
runtime_expected=3a772f29855c0016855c0a7836b0db675c36acfdac928315f2f7002f1e9fcd83
runtime_actual=$(shasum -a 256 "$cli_dir/cli-runtime.js" | awk '{print $1}')
[[ "$runtime_actual" == "$runtime_expected" ]] || { echo 'Bundled runtime hash changed; ask the parent to verify it' >&2; exit 2; }
# Node is required for the installed CLI, concurrent RPC/SSE and extension tests.
node_command=$(command -v node)
exec "$node_command" "$candidate/pi/tests/task-cues/runtime.mjs" "$cli" "$2" "$3"

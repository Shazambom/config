#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ $# -gt 1 ]]; then
  echo 'usage: bash pi/test-todo.sh [TODO_EXTENSION_PATH]' >&2
  exit 2
fi
source "$here/command-path.sh"
pi_cli="$(pi_real_command "$(command -v pi)")"
pi_package="$(cd -- "$(dirname -- "$pi_cli")/../.." && pwd -P)"
node_command="$(command -v node)"
todo="${1:-$here/agent/extensions/todo.ts}"
if [[ "$todo" != /* ]]; then todo="$PWD/$todo"; fi
sandbox_command="$(command -v sandbox-exec || true)"
evidence="$(mktemp -d "${TMPDIR:-/tmp}/pi-todo-test.XXXXXX")"
evidence="$(cd -- "$evidence" && pwd -P)"
mkdir -p "$evidence/home" "$evidence/tmp"
# Node is needed for the installed SDK and concurrent real CLI RPC/loopback SSE.
if env -i PATH="$PATH" HOME="$evidence/home" TMPDIR="$evidence/tmp" \
  "$node_command" "$here/tests/todo/runtime.mjs" "$pi_cli" "$pi_package" \
  "$evidence" "$todo" "$sandbox_command" > "$evidence/run.log" 2>&1; then
  cat "$evidence/run.log"
  rm -rf -- "$evidence"
else
  cat "$evidence/run.log" >&2
  printf 'TODO test evidence retained: %s\n' "$evidence" >&2
  exit 1
fi

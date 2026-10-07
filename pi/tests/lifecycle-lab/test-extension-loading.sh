#!/usr/bin/env bash
# Exercise an explicitly selected extension through the actual bundled CLI.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
proof="$(mktemp -d "${TMPDIR:-/tmp}/lifecycle-extension.XXXXXX")"
proof="$(cd "$proof" && pwd -P)"
id=''
cleanup() { rc=$?; trap - EXIT; if [[ -n "$id" ]]; then bash "$here/lab.sh" cleanup "$id" || rc=2; fi; printf 'Evidence: %s\n' "$proof"; exit "$rc"; }
trap cleanup EXIT
# JavaScript is necessary here to implement the application extension API.
cat > "$proof/probe.mjs" <<'JS'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default function(pi) {
  pi.on('session_start', (_event, ctx) => {
    writeFileSync(join(process.env.LIFECYCLE_LAB, 'extension-started'), 'loaded\n');
    ctx.ui.notify('EXTENSION_PROOF_LOADED', 'info');
  });
}
JS
created="$(bash "$here/lab.sh" create --extension "$proof/probe.mjs")"
printf '%s\n' "$created" > "$proof/lab.json"
id="$(jq -r .id <<< "$created")"
evidence="$(jq -r .evidence <<< "$created")"
bash "$here/lab.sh" attach "$id" first
bash "$here/lab.sh" open "$id" chat
for ((i=0;i<100;i++)); do [[ -f "$evidence/extension-started" ]] && break; sleep .1; done
[[ "$(< "$evidence/extension-started")" == loaded ]]
jq -e --arg path "$proof/probe.mjs" '.extensions == [$path]' "$evidence/cli.json" >/dev/null
bash "$here/lab.sh" type "$id" chat 'EXTENSION_CHAT_CHECK'
bash "$here/lab.sh" key "$id" chat Enter
for ((i=0;i<100;i++)); do
  bash "$here/lab.sh" saved "$id" chat > "$proof/saved.txt"
  grep -q 'LAB_REPLY EXTENSION_CHAT_CHECK' "$proof/saved.txt" && break
  sleep .1
done
grep -q 'LAB_REPLY EXTENSION_CHAT_CHECK' "$proof/saved.txt"
for ((i=0;i<100;i++)); do
  bash "$here/lab.sh" screen "$id" chat > "$proof/screen.txt"
  grep -q 'LAB_REPLY EXTENSION_CHAT_CHECK' "$proof/screen.txt" && break
  sleep .1
done
grep -q 'LAB_REPLY EXTENSION_CHAT_CHECK' "$proof/screen.txt"
printf 'PASS explicit extension loaded and real provider response visible and saved\n'

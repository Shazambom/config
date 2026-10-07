#!/usr/bin/env bash
# Reference refusal tests the approved startup-metadata allowance, not a production guard.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
proof="$(mktemp -d "${TMPDIR:-/tmp}/lifecycle-relaxed-startup.XXXXXX")"
printf 'Evidence: %s\n' "$proof"
# Real Pi still opens its session normally. Only the second test instance refuses
# at extension session_start; the native metadata write is deliberately retained.
cat > "$proof/refuse-second.mjs" <<'JS'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default function(pi) {
  pi.on('session_start', (_event, ctx) => {
    try {
      writeFileSync(join(process.env.LIFECYCLE_LAB, 'reference-first-instance'), '', { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      ctx.ui.notify('Session already open: reference refusal', 'error');
      ctx.shutdown();
    }
  });
}
JS
rc=0
bash "$here/../../test-lifecycle-ownership.sh" --extension "$proof/refuse-second.mjs" > "$proof/ownership.log" 2>&1 || rc=$?
printf 'Ownership result: %s\n' "$rc"
[[ $rc == 0 ]] || { tail -12 "$proof/ownership.log"; exit 1; }
printf 'PASS startup metadata permitted; second model work blocked; original owner remains usable\n'

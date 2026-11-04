#!/usr/bin/env bash
# Check the actual installed module graph in a private init.sh deployment.
set -euo pipefail
[[ $# == 1 ]] || { echo 'Usage: wakeups-deploy.sh PRIVATE_PI_HOME' >&2; exit 2; }
agent=$(cd "$1/agent" && pwd)
jq -e '.extensions as $e | ($e | map(select(. == "./wakeups/index.ts")) | length) == 1 and ($e | index("./wakeups/index.ts")) > ($e | index("./lifecycle/session-lifecycle.ts"))' "$agent/settings.json" >/dev/null
node --input-type=module - "$agent" <<'JS'
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const agent=process.argv[2];
const entry=join(agent,'wakeups/runtime.mjs');
const runtime=await import(pathToFileURL(entry));
assert.equal(typeof runtime.default,'function');
const require=createRequire(entry);
assert.equal(require('cron-parser/package.json').version,'5.10.2');
assert.equal(require('luxon/package.json').version,'3.7.2');
console.log('PASS deployed timer runtime imports exact calendar dependencies');
JS

#!/usr/bin/env bash
set -euo pipefail
work="${1:?evidence directory}"
repo="${2:?repository}"
private="$work/repo"
clean=(env -i "HOME=$work/home" "PATH=$work/bin:$PATH" "CONFIG_PI_HOME=$work/state" CONFIG_PI_NO_PROMPT=1)
run() { "${clean[@]}" bash "$private/init.sh" --pi-delivery "$work/$1.json" > "$work/$1.log" 2>&1; }
refuse() { if run "$1"; then echo "Unexpected success: $1" >&2; exit 1; fi; }
# Existing evidence is not overwritten or used as this invocation's result.
cp "$work/failed.json" "$work/saved.json"
refuse failed
cmp "$work/failed.json" "$work/saved.json"
mkdir "$work/directory.json"
refuse directory
[[ -z "$(ls -A "$work/directory.json")" ]]
ln -s "$work/saved.json" "$work/symlink.json"
refuse symlink
cmp "$work/failed.json" "$work/saved.json"
# An observer that lies with exit zero cannot satisfy the unchanged acceptance.
cp "$private/pi/rpc-readiness.sh" "$work/refusing-checker.sh"
printf 'printf "{broken observer}\\n"\nexit 0\n' > "$private/pi/rpc-readiness.sh"
refuse broken-observer
jq -e '.setup_exit == 0 and .artifact_check.state == "unknown" and .artifact_check.reason == "invalid_observer_result"' "$work/broken-observer.json" >/dev/null
cp "$work/refusing-checker.sh" "$private/pi/rpc-readiness.sh"
# Ordinary paths invoke setup's existing apply only, never the additional check.
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "${2:---apply}" >> %q\nexec bash %q "$@"\n' "$work/check-calls" "$work/refusing-checker.sh" > "$private/pi/rpc-readiness.sh"
for n in 1 2; do
  "${clean[@]}" bash "$private/init.sh" --pi-no-terminal > "$work/ordinary-$n.log" 2>&1
done
"${clean[@]}" bash "$private/pi.sh" --version > "$work/ordinary-launch.log" 2>&1
printf '%s\n' --apply --apply --apply > "$work/expected-calls"
cmp "$work/check-calls" "$work/expected-calls"
cp "$work/refusing-checker.sh" "$private/pi/rpc-readiness.sh"
# Static positive calibration uses the same checker and its one hash allowlist.
bash "$repo/pi/rpc-readiness.sh" "$work/package" > "$work/apply-good.log"
run good
jq -e '.setup_exit == 0 and .operation_exit == 0 and .artifact_check.state == "passed" and (.artifact_check.assets|length == 13) and .behavior == "not_run"' "$work/good.json" >/dev/null
cp "$work/good.json" "$work/old-success.json"
refuse good
cmp "$work/good.json" "$work/old-success.json"
# Different destinations can complete concurrently; a shared one has one owner.
run parallel-a & a=$!
run parallel-b & b=$!
a_status=0; b_status=0
wait "$a" || a_status=$?
wait "$b" || b_status=$?
# Existing setup shares source.ts.portable and is not concurrency-safe. Each
# receipt must report its own actual outcome, not conceal that installer race.
jq -s -e --argjson a "$a_status" --argjson b "$b_status" '
  .[0].operation_id != .[1].operation_id and
  .[0].operation_exit == $a and .[1].operation_exit == $b and
  all(.[]; .completion == "observed" and
    (.operation_exit == 0) == (.setup_exit == 0 and .artifact_check.state == "passed"))
' "$work/parallel-a.json" "$work/parallel-b.json" >/dev/null
run shared & a=$!
run shared & b=$!
a_status=0; b_status=0
wait "$a" || a_status=$?
wait "$b" || b_status=$?
[[ $((a_status+b_status)) == 1 ]]
jq -e '.completion == "observed" and .artifact_check.state == "passed"' "$work/shared.json" >/dev/null
# Recognized mixed/absent/version failures remain distinct from observer errors.
cp "$work/package/dist/core/extensions/runner.js" "$work/runner-good.js"
printf 'changed\n' >> "$work/package/dist/core/extensions/runner.js"
refuse changed-asset
jq -e '.artifact_check.state == "failed" and .artifact_check.reason == "unrecognized_asset"' "$work/changed-asset.json" >/dev/null
cp "$work/runner-good.js" "$work/package/dist/core/extensions/runner.js"
(cd "$work/package"; GIT_CEILING_DIRECTORIES="$work" git apply -R --include=dist/core/extensions/runner.js "$repo/pi/patches/rpc-readiness.patch")
refuse mixed-assets
jq -e '.artifact_check.state == "failed" and .artifact_check.reason == "mixed_assets"' "$work/mixed-assets.json" >/dev/null
rm "$work/package/dist/core/extensions/runner.js"
refuse missing-asset
jq -e '.artifact_check.state == "failed" and .artifact_check.reason == "missing_asset"' "$work/missing-asset.json" >/dev/null
ln -s "$work/runner-good.js" "$work/package/dist/core/extensions/runner.js"
refuse symlink-asset
jq -e '.artifact_check.state == "failed" and .artifact_check.reason == "symlink"' "$work/symlink-asset.json" >/dev/null
rm "$work/package/dist/core/extensions/runner.js"
cp "$work/runner-good.js" "$work/package/dist/core/extensions/runner.js"
cp "$work/package/package.json" "$work/package-identity.json"
jq '.version="0.0.0"' "$work/package-identity.json" > "$work/package/package.json"
refuse old-runtime
jq -e '.artifact_check.state == "failed" and .artifact_check.reason == "unsupported_version"' "$work/old-runtime.json" >/dev/null
cp "$work/package-identity.json" "$work/package/package.json"
# Global selection must not be replaced by rediscovering the passing fallback.
mkdir -p "$work/other-package/dist/bundle"
cp "$work/package/dist/bundle/cli.js" "$work/other-package/dist/bundle/cli.js"
printf '{"name":"@earendil-works/pi-coding-agent","version":"0.0.0"}\n' > "$work/other-package/package.json"
ln -s "$work/other-package/dist/bundle/cli.js" "$work/bin/pi"
if env -i "HOME=$work/home" "PATH=$work/bin:$PATH" CONFIG_PI_NO_PROMPT=1 bash "$private/init.sh" --pi-delivery "$work/global.json" > "$work/global.log" 2>&1; then exit 1; fi
jq -e --arg package "$work/other-package" '.setup_exit == 0 and (.selected_package | endswith("/other-package")) and .artifact_check.state == "failed" and .artifact_check.version == "0.0.0"' "$work/global.json" >/dev/null
rm "$work/bin/pi" "$work/bin/.pi-portable-real"
# Missing/unwritable parents refuse before running setup.
if "${clean[@]}" bash "$private/init.sh" --pi-delivery "$work/missing/receipt.json" > "$work/missing-parent.log" 2>&1; then exit 1; fi
mkdir "$work/unwritable"; chmod 500 "$work/unwritable"
if "${clean[@]}" bash "$private/init.sh" --pi-delivery "$work/unwritable/receipt.json" > "$work/unwritable.log" 2>&1; then chmod 700 "$work/unwritable"; exit 1; fi
chmod 700 "$work/unwritable"
# Child errexit must not be disabled by an if-tested shell function.
cp "$private/pi/setup.sh" "$work/setup-real.sh"
printf 'set -e\nfalse\nprintf BAD > %q\n' "$work/errexit-disabled" > "$private/pi/setup.sh"
refuse early-failure
[[ ! -e "$work/errexit-disabled" ]]
jq -e '.setup_exit == 1 and .selected_package == null and .artifact_check.state == "unknown"' "$work/early-failure.json" >/dev/null
# Failure of final atomic publication leaves only the initial uncertain record.
printf 'jq -n --arg package %q "{package:\\$package}" > "$2"\n' "$work/package" > "$private/pi/setup.sh"
printf '#!/bin/sh\nexit 71\n' > "$work/bin/mv"; chmod +x "$work/bin/mv"
refuse publication
jq -e '.completion == "not_observed" and .setup_exit == null' "$work/publication.json" >/dev/null
rm "$work/bin/mv"
# Cancellation of our wrapper preserves initial uncertainty, not process liveness.
mkfifo "$work/ready" "$work/hold"
printf 'printf "%%s\\n" "$$" > %q\nread -r value < %q\n' "$work/ready" "$work/hold" > "$private/pi/setup.sh"
"${clean[@]}" bash "$private/pi/delivery.sh" "$work/interrupted.json" > "$work/interrupted.log" 2>&1 & wrapper=$!
read -r setup_pid < "$work/ready"
kill -TERM "$wrapper"
status=0; wait "$wrapper" || status=$?
[[ "$status" == 143 ]]
jq -e '.completion == "not_observed" and .setup_exit == null and .artifact_check.state == "unknown"' "$work/interrupted.json" >/dev/null
# Reap/check only the known test child. No assumption about arbitrary descendants.
if kill -0 "$setup_pid" 2>/dev/null; then
  echo 'Known setup child still exists after signal; cleanup only' > "$work/signal-limit.txt"
  kill -TERM "$setup_pid" 2>/dev/null || true
fi
printf 'printf "%%s\\n" "$$" > %q\necho DELIVERY_SIGNAL_READY\nread -r value < %q\n' "$work/tool-setup.pid" "$work/hold" > "$private/pi/setup.sh"
"${clean[@]}" node "$repo/pi/tests/delivery/signal.mjs" "$work"
cp "$work/setup-real.sh" "$private/pi/setup.sh"
"${clean[@]}" python3 "$repo/pi/tests/delivery/credentials-pty.py" "$work"
jq -e '.google_search_api_key == "synthetic-delivery-key" and .google_cse_id == "synthetic-delivery-engine"' "$work/pty-state/agent/extensions/web-search/auth.json" >/dev/null
bash "$repo/pi/tests/delivery/identity-faults.sh" "$work"
echo 'PASS: collision, broken observer, ordinary no-check, static pass, concurrency, asset/version failures, errexit, cancellation uncertainty'

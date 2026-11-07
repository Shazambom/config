#!/usr/bin/env bash
set -euo pipefail
work="$(cd -- "${1:?private evidence directory}" && pwd -P)"
real_jq="$(command -v jq)"
mkdir -p "$work/fault-bin"
# Fail only the identity read. Receipt JSON serialization must remain functional.
printf '#!/usr/bin/env bash\nfor last; do :; done\nif [[ "$last" == "$(< %q)" ]]; then echo IDENTITY_OBSERVER_FAULT >&2; exit 1; fi\nexec %q "$@"\n' "$work/fault-target" "$real_jq" > "$work/fault-bin/jq"
chmod +x "$work/fault-bin/jq"
for target in package.json node_modules/@earendil-works/pi-agent-core/package.json; do
  name=package; [[ "$target" == package.json ]] || name=core
  printf '%s\n' "$work/package/$target" > "$work/fault-target"
  result=0
  env -i "HOME=$work/home" "PATH=$work/fault-bin:$work/bin:$PATH" "CONFIG_PI_HOME=$work/state" CONFIG_PI_NO_PROMPT=1 bash "$work/repo/init.sh" --pi-delivery "$work/identity-$name.json" > "$work/identity-$name.log" 2>&1 || result=$?
  [[ "$result" != 0 ]]
  jq -e '.setup_exit == 0 and .artifact_check.state == "unknown" and (.artifact_check.diagnostics | contains("IDENTITY_OBSERVER_FAULT"))' "$work/identity-$name.json" >/dev/null
  cp "$work/package/$target" "$work/identity-$name-original.json"
  printf '{broken' > "$work/package/$target"
  if bash "$work/repo/pi/rpc-readiness-real.sh" "$work/package" --check-json > "$work/identity-$name-parse.json" 2> "$work/identity-$name-parse.log"; then exit 1; fi
  jq -e '.state == "unknown"' "$work/identity-$name-parse.json" >/dev/null
  jq '.name="observed-wrong-name"' "$work/identity-$name-original.json" > "$work/package/$target"
  if bash "$work/repo/pi/rpc-readiness-real.sh" "$work/package" --check-json > "$work/identity-$name-mismatch.json" 2> "$work/identity-$name-mismatch.log"; then exit 1; fi
  jq -e '.state == "failed"' "$work/identity-$name-mismatch.json" >/dev/null
  cp "$work/identity-$name-original.json" "$work/package/$target"
done
printf 'PASS: package/core identity observer failures remain unknown with diagnostics\n'

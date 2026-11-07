#!/usr/bin/env bash
# Installed native T3 -> real Pi RPC -> loopback model, with private state only.
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/.." && pwd -P)"
source "$root/pi/command-path.sh"
app=""; cli=""; settings=""; launch_args="--offline"; leaf_profile=""; scenario=""; observe_tools=false; launcher_fixture=""; wakeups_mode="sequential"; wakeups_schedule="every"; identity_check=false; instructions=""; cue_check=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --pi-cli) cli="$2"; shift 2 ;;
    --agent-settings) settings="$2"; shift 2 ;;
    --launch-args) launch_args="$2"; shift 2 ;;
    --leaf-profile) leaf_profile="$2"; scenario="leaf"; shift 2 ;;
    --arena) scenario="arena"; shift ;;
    --arena-off) scenario="arena-off"; shift ;;
    --arena-dropout) scenario="arena-dropout"; shift ;;
    --arena-cancel) scenario="arena-cancel"; shift ;;
    --controls) scenario="controls"; shift ;;
    --resume) scenario="resume"; shift ;;
    --permission-refusal) scenario="permission-refusal"; shift ;;
    --observe-tools) observe_tools=true; shift ;;
    --wakeups) scenario="wakeups"; shift ;;
    --wakeups-parallel) scenario="wakeups"; wakeups_mode="parallel"; shift ;;
    --wakeups-cron) scenario="wakeups"; wakeups_schedule="cron"; shift ;;
    --identity-check) identity_check=true; shift ;;
    --cue-check) identity_check=true; cue_check=true; shift ;;
    --cue-recovery) scenario="cue-recovery"; identity_check=true; cue_check=true; shift ;;
    --agent-instructions) instructions="$2"; shift 2 ;;
    --launcher-fixture) launcher_fixture="$(cd "$2" && pwd -P)"; shift 2 ;;
    *) echo "Usage: $0 [--app bundle] [--pi-cli executable] [--agent-settings settings.json] [--launch-args '--offline --t3 --team'] [--leaf-profile proof-leaf.md | --arena | --arena-off | --arena-dropout | --arena-cancel] [--controls | --permission-refusal] [--launcher-fixture directory] [--observe-tools]" >&2; exit 2 ;;
  esac
done
if [[ -n "$launcher_fixture" && "$scenario" == permission-refusal ]]; then
  echo 'Permission-refusal proof currently requires direct candidate settings, not launcher deployment.' >&2
  exit 2
fi
if [[ -z "$app" ]]; then
  for candidate in /Applications/*.app "$HOME"/Applications/*.app; do
    # Electron ASAR is a virtual directory, not a filesystem directory.
    case "$(basename "$candidate")" in 'T3 Code'*.app) app="$candidate"; break ;; esac
  done
fi
[[ -d "$app" ]] || { echo 'Pass the installed T3 bundle with --app.' >&2; exit 2; }
app="$(cd "$app" && pwd -P)"
exe="$(plutil -extract CFBundleExecutable raw "$app/Contents/Info.plist")"
if [[ -n "$launcher_fixture" ]]; then
  [[ -f "$launcher_fixture/evidence/prepared.txt" ]] || { echo 'Launcher fixture is not prepared.' >&2; exit 2; }
  cli="$launcher_fixture/repo/pi.sh"
fi
cli="$(pi_real_command "${cli:-$(command -v pi)}")"
node="$(command -v node)"; jq="$(command -v jq)"
work="$(mktemp -d "${TMPDIR:-/tmp}/t3-runtime.XXXXXX")"
work="$(cd "$work" && pwd -P)"
printf 'Runtime evidence: %s\n' "$work"
mkdir -p "$work"/{home,agent,workspace,state/userdata,config,cache,data,tmp,bin}
if [[ -n "$launcher_fixture" ]]; then
  rmdir "$work/agent"
  mkdir -p "$work/home/.pi/agent"
  ln -s "$work/home/.pi/agent" "$work/agent"
fi
if [[ -n "$settings" ]]; then "$jq" . "$settings" > "$work/agent/settings.json"; else
  printf '%s\n' '{"defaultProvider":"fixture","defaultModel":"fixture","retry":{"enabled":false},"compaction":{"enabled":false}}' > "$work/agent/settings.json"
fi
if [[ "$scenario" == cue-recovery ]]; then
  cp "$root/pi/tests/t3-runtime/recovery-probe.ts" "$work/recovery-probe.ts"
  "$jq" --arg probe "$work/recovery-probe.ts" '.extensions=((.extensions // [])+[$probe])' "$work/agent/settings.json" > "$work/agent/recovery-settings.json"
  mv "$work/agent/recovery-settings.json" "$work/agent/settings.json"
fi
if [[ "$cue_check" == true ]]; then printf 'required\n' > "$work/cue-required"; fi
if [[ "$identity_check" == true ]]; then
  cp "$root/pi/tests/t3-runtime/identity-observe.ts" "$work/identity-observe.ts"
  "$jq" --arg probe "$work/identity-observe.ts" '.extensions=((.extensions // [])+[$probe])' "$work/agent/settings.json" > "$work/agent/identity-settings.json"
  mv "$work/agent/identity-settings.json" "$work/agent/settings.json"
fi
if [[ -n "$instructions" ]]; then cp "$instructions" "$work/agent/AGENTS.md"; fi
if [[ "$scenario" == wakeups ]]; then
  [[ -n "$settings" ]] || { echo 'Wakeups scenario requires private frozen candidate settings.' >&2; exit 2; }
  printf '{"mode":"%s","schedule":"%s"}\n' "$wakeups_mode" "$wakeups_schedule" > "$work/wake-mode.json"
  cp "$root/pi/tests/t3-runtime/wakeups-probe.ts" "$work/wakeups-probe.ts"
  "$jq" --arg probe "$work/wakeups-probe.ts" '.extensions=((.extensions // [])+[$probe])' "$work/agent/settings.json" > "$work/agent/probe-settings.json"
  mv "$work/agent/probe-settings.json" "$work/agent/settings.json"
fi
if [[ "$scenario" == permission-refusal ]]; then
  cp "$root/pi/tests/t3-runtime/approval-probe.ts" "$work/approval-probe.ts"
  "$jq" --arg probe "$work/approval-probe.ts" '.extensions=((.extensions // [])+[$probe])' "$work/agent/settings.json" > "$work/agent/probe-settings.json"
  mv "$work/agent/probe-settings.json" "$work/agent/settings.json"
fi
if [[ "$observe_tools" == true ]]; then
  cp "$root/pi/tests/t3-runtime/observe-tools.ts" "$work/observe-tools.ts"
  "$jq" --arg observer "$work/observe-tools.ts" '.extensions=((.extensions // [])+[$observer])' "$work/agent/settings.json" > "$work/agent/observed-settings.json"
  mv "$work/agent/observed-settings.json" "$work/agent/settings.json"
fi
"$jq" -n --arg cli "$cli" --arg node "$node" '{cli:$cli,node:$node}' > "$work/selected-runtime.json"
shasum -a 256 "$cli" "$work/agent/settings.json" > "$work/input-artifacts.sha256"
while IFS= read -r extension; do
  [[ -f "$extension" ]] || continue
  shasum -a 256 "$extension" >> "$work/input-artifacts.sha256"
  adapter="$(dirname -- "$extension")/t3-adapter.ts"
  [[ ! -f "$adapter" ]] || shasum -a 256 "$adapter" >> "$work/input-artifacts.sha256"
done < <("$jq" -r '.extensions[]? | select(type=="string")' "$work/agent/settings.json")
if [[ -n "$leaf_profile" ]]; then
  mkdir -p "$work/agent/agents"
  cp "$leaf_profile" "$work/agent/agents/proof-leaf.md"
fi
# Absolute candidate paths are copied only into the private launcher, never source.
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$$" >> %q\nprintf "%%s %%s\\n" "$$" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" >> %q\nexec %q %q "$@" 2>> %q\n' "$work/pi-pids.txt" "$work/launcher-starts.txt" "$node" "$cli" "$work/pi-startup.stderr" > "$work/bin/fixture-pi"
if [[ -n "$launcher_fixture" ]]; then
  # Native host environment discovery can rewrite PATH. Pin only fixture infrastructure.
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$$" >> %q\nprintf "pid=%%s time=%%s argc=%%s runtime=%%s browsers=%%s path=%%s\\n" "$$" "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" "$#" "${CONFIG_PI_RUNTIME_DIR:-unset}" "${PLAYWRIGHT_BROWSERS_PATH:-unset}" "$PATH" >> %q\nexport HOME=%q CONFIG_PI_RUNTIME_DIR=%q PLAYWRIGHT_BROWSERS_PATH=%q\nexport PATH=%q:"$PATH"\nunset CONFIG_PI_HOME\nexec %q "$@"\n' "$work/pi-pids.txt" "$work/launcher-environment.txt" "$work/home" "$launcher_fixture/runtime" "$launcher_fixture/browsers" "$launcher_fixture/bin" "$cli" > "$work/bin/fixture-pi"
fi
chmod 700 "$work/bin/fixture-pi"
"$jq" -n --arg bin "$work/bin/fixture-pi" --arg args "$launch_args" --arg leaf "$scenario" '({providerInstances:{fixturePi:{driver:"pi",enabled:true,config:{binaryPath:$bin,launchArgs:$args}}}} + if $leaf != "" then {defaultRuntimeMode:"full-access"} else {} end) | if ($leaf=="arena-cancel" or $leaf=="permission-refusal") then .providerInstances.fixtureControl={driver:"pi",enabled:true,config:{binaryPath:$bin,launchArgs:"--offline"}} else . end' > "$work/state/userdata/settings.json"
shasum -a 256 "$app/Contents/Resources/app.asar" "$app/Contents/MacOS/$exe" > "$work/installed-app.before.sha256"
# Allowlisted environment: no provider credentials, proxy, desktop bootstrap or user state.
runtime_path="$(dirname "$node"):/usr/bin:/bin:/usr/sbin:/sbin"
extra_env=(); runner=()
if [[ -n "$launcher_fixture" ]]; then
  hash_original_assets() {
    while IFS= read -r tree; do
      printf 'ROOT %s\n' "$tree"
      "$node" "$root/pi/tests/t3-runtime/snapshot.mjs" hash "$tree"
    done < "$launcher_fixture/evidence/original-asset-roots.txt"
  }
  hash_original_assets > "$work/original-assets.before.sha256"
  runtime_path="$launcher_fixture/bin:$runtime_path"
  extra_env=("CONFIG_PI_RUNTIME_DIR=$launcher_fixture/runtime" "PLAYWRIGHT_BROWSERS_PATH=$launcher_fixture/browsers")
  codesign --verify --strict /bin/ps > "$work/ps-signature-check.txt" 2>&1
  shasum -a 256 /bin/ps > "$work/ps.before.sha256"
  quoted_work="$("$jq" -Rn --arg path "$work" '$path')"
  quoted_fixture="$("$jq" -Rn --arg path "$launcher_fixture" '$path')"
  printf '(version 1)(allow default)(allow process-exec (literal "/bin/ps") (with no-sandbox))(deny network*)(allow network-outbound (remote ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))(allow network-bind (local ip "localhost:*"))(deny file-write*)(allow file-write-data (literal "/private/var/tmp"))(allow file-write* (regex "^/private/var/tmp/sh-thd-[0-9]+$"))(allow file-write* (subpath %s) (subpath %s) (literal "/dev/null"))\n' "$quoted_work" "$quoted_fixture" > "$work/offline.sb"
  runner=(sandbox-exec -f "$work/offline.sb")
  cp "$launcher_fixture/evidence/prepared.txt" "$work/launcher-input.txt"
fi
if [[ ( "$scenario" == wakeups || "$identity_check" == true ) && -z "$launcher_fixture" ]]; then
  codesign --verify --strict /bin/ps > "$work/ps-signature-check.txt" 2>&1
  shasum -a 256 /bin/ps > "$work/ps.before.sha256"
  quoted_work="$("$jq" -Rn --arg path "$work" '$path')"
  printf '(version 1)(allow default)(allow process-exec (literal "/bin/ps") (with no-sandbox))(deny network*)(allow network-outbound (remote ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))(allow network-bind (local ip "localhost:*"))(deny file-write*)(allow file-write-data (literal "/private/var/tmp"))(allow file-write* (regex "^/private/var/tmp/sh-thd-[0-9]+$"))(allow file-write* (subpath %s) (literal "/dev/null"))\n' "$quoted_work" > "$work/offline.sb"
  runner=(sandbox-exec -f "$work/offline.sb")
fi
cd "$work/workspace"
set +e
env -i HOME="$work/home" PATH="$runtime_path" \
  TMPDIR="$work/tmp" T3CODE_HOME="$work/state" PI_CODING_AGENT_DIR="$work/agent" \
  XDG_CONFIG_HOME="$work/config" XDG_CACHE_HOME="$work/cache" XDG_DATA_HOME="$work/data" \
  DO_NOT_TRACK=1 NO_COLOR=1 ${extra_env[@]+"${extra_env[@]}"} ${runner[@]+"${runner[@]}"} "$node" "$root/pi/tests/t3-runtime/runtime.mjs" \
  "$work" "$app/Contents/MacOS/$exe" "$app/Contents/Resources/app.asar/apps/server/dist/bin.mjs" "$jq" "$scenario"
status=$?
set -e
shasum -a 256 "$app/Contents/Resources/app.asar" "$app/Contents/MacOS/$exe" > "$work/installed-app.after.sha256"
if [[ -n "$launcher_fixture" ]]; then
  hash_original_assets > "$work/original-assets.after.sha256"
  cmp "$work/original-assets.before.sha256" "$work/original-assets.after.sha256"
  shasum -a 256 /bin/ps > "$work/ps.after.sha256"
  cmp "$work/ps.before.sha256" "$work/ps.after.sha256"
  adapter_ref="$("$jq" -r '.[]|select(.name=="pi-interactive-subagents")|.ref' "$launcher_fixture/repo/pi/upstream.json")"
  deployed_adapter="$launcher_fixture/repo/pi/upstream/pi-interactive-subagents-$adapter_ref/pi-extension/subagents/t3-adapter.ts"
  shasum -a 256 "$deployed_adapter" > "$work/deployed-adapter.sha256"
  read -r expected_adapter _ < "$launcher_fixture/evidence/frozen-adapter.sha256"
  read -r actual_adapter _ < "$work/deployed-adapter.sha256"
  [[ "$actual_adapter" == "$expected_adapter" ]] || { echo 'Deployed adapter differs from frozen checkpoint.' >&2; exit 1; }
fi
if [[ ( "$scenario" == wakeups || "$identity_check" == true ) && -z "$launcher_fixture" ]]; then
  shasum -a 256 /bin/ps > "$work/ps.after.sha256"
  cmp "$work/ps.before.sha256" "$work/ps.after.sha256"
fi
cmp "$work/installed-app.before.sha256" "$work/installed-app.after.sha256" || { echo 'Installed T3 artifact hashes changed.' >&2; exit 1; }
if [[ -f "$work/proof.json" ]]; then
  "$jq" --arg launcher "$launcher_fixture" '.artifactChecks={installedT3Unchanged:true,originalDependencyAssetsUnchanged:($launcher!=""),verifiedSystemPsUnchanged:($launcher!=""),deployedFrozenAdapterMatches:($launcher!="")}' "$work/proof.json" > "$work/proof.checked.json"
  mv "$work/proof.checked.json" "$work/proof.json"
fi
exit "$status"

#!/usr/bin/env bash
# Offline, private inputs for an unchanged pi.sh bootstrap. No setup is skipped.
set -euo pipefail
umask 077
[[ $# == 5 ]] || { echo 'Usage: prepare-launcher.sh REPO CHECKPOINT CANDIDATE_PACKAGE VERIFIED_UPSTREAM_ARCHIVE NEW_FIXTURE_DIR' >&2; exit 2; }
repo="$(cd "$1" && pwd -P)"; checkpoint="$(cd "$2" && pwd -P)"; candidate="$(cd "$3" && pwd -P)"; archive="$4"; fixture="$5"
[[ ! -e "$fixture" ]] || { echo 'Fixture directory must not exist.' >&2; exit 2; }
[[ -f "$archive" ]] || { echo 'Original pinned archive is required; no download fallback.' >&2; exit 2; }
node="$(command -v node)"; jq="$(command -v jq)"; tmux="$(command -v tmux)"
command -v sandbox-exec >/dev/null || { echo 'Offline launcher proof currently requires macOS sandbox-exec.' >&2; exit 2; }
name=pi-interactive-subagents
spec="$(jq -c --arg name "$name" '.[]|select(.name==$name)' "$repo/pi/upstream.json")"
ref="$(jq -r .ref <<< "$spec")"; expected="$(jq -r .sha256 <<< "$spec")"
actual="$(shasum -a 256 "$archive")"; [[ "${actual%% *}" == "$expected" ]] || { echo 'Pinned archive SHA mismatch.' >&2; exit 1; }
mkdir -p "$fixture"; fixture="$(cd "$fixture" && pwd -P)"
printf '%s\n' "$fixture"
mkdir -p "$fixture"/{repo,bin,archives,browsers,evidence}
printf '%s\n' "$repo/pi/node_modules" "$repo/pi/upstream" "$candidate" > "$fixture/evidence/original-asset-roots.txt"
(cd "$repo"; git ls-files -c -o --exclude-standard -- init.sh pi.sh pi claude tmux iterm2) > "$fixture/evidence/source-files.txt"
hash_sources() { (cd "$repo"; while IFS= read -r file; do shasum -a 256 "$file"; done < "$fixture/evidence/source-files.txt"); }
hash_sources > "$fixture/evidence/source.before.sha256"
"$node" "$repo/pi/tests/t3-runtime/snapshot.mjs" hash "$repo/pi/node_modules" "$repo/pi/upstream" "$candidate" > "$fixture/evidence/dependencies.before.sha256"
(cd "$repo"; tar -cf - -T "$fixture/evidence/source-files.txt") | (cd "$fixture/repo"; tar -xf -)
cp -R "$repo/pi/node_modules" "$fixture/repo/pi/"
cp -R "$repo/pi/upstream" "$fixture/repo/pi/"
# Candidate dependencies are fully private, including patched agent-core types.
cp -RL "$candidate" "$fixture/candidate"
cp "$checkpoint/interactive-subagents.patch" "$fixture/repo/pi/patches/interactive-subagents.patch"
shasum -a 256 "$checkpoint/interactive-subagents.patch" > "$fixture/evidence/frozen-patch.sha256"
shasum -a 256 "$checkpoint/package/pi-extension/subagents/t3-adapter.ts" > "$fixture/evidence/frozen-adapter.sha256"
cp "$archive" "$fixture/archives/subagents.tgz"
while IFS= read -r other; do
  other_name="$("$jq" -r .name <<< "$other")"
  [[ "$other_name" != "$name" ]] || continue
  other_ref="$("$jq" -r .ref <<< "$other")"; other_patch="$("$jq" -r '.patch // empty' <<< "$other")"
  stamp="$other"
  if [[ -n "$other_patch" ]]; then
    digest="$(shasum -a 256 "$fixture/repo/pi/patches/$other_patch")"
    stamp="$("$jq" -c --arg digest "${digest%% *}" '.+{patchSha256:$digest}' <<< "$other")"
  fi
  stamp_file="$fixture/repo/pi/upstream/$other_name-$other_ref/.portable-source.json"
  [[ -f "$stamp_file" && "$(< "$stamp_file")" == "$stamp" ]] || { printf 'Unseeded upstream mismatch: %s\n' "$other_name" >&2; exit 1; }
done < <("$jq" -c '.[]' "$fixture/repo/pi/upstream.json")
cmp "$fixture/repo/pi/package-lock.json" "$fixture/repo/pi/node_modules/.portable-lock.json"
# Preserve the repository fallback and force the real updater to validate/archive/patch.
rm -f "$fixture/repo/pi/upstream/$name-$ref/.portable-source.json"
url="https://codeload.github.com/$(jq -r '.repository // ("amosblomqvist/"+.name)' <<< "$spec")/tar.gz/$ref"
printf '#!/usr/bin/env bash\nset -euo pipefail\nexpected=%q\narchive=%q\nlog=%q\nurl=""; out=""\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) out="$2"; shift 2;; https://*) url="$1"; shift;; *) shift;; esac; done\n[[ "$url" == "$expected" && -n "$out" ]] || { echo "Offline bootstrap transport refused an unexpected fetch" >&2; exit 98; }\nprintf "verified local archive copy\\n" >> "$log"\ncp "$archive" "$out"\n' "$url" "$fixture/archives/subagents.tgz" "$fixture/evidence/local-transport.log" > "$fixture/bin/curl"
for command in wget npm brew apt-get dnf pacman; do printf '#!/usr/bin/env bash\necho "Offline bootstrap refuses %s invocation" >&2\nexit 98\n' "$command" > "$fixture/bin/$command"; done
ln -s "$fixture/candidate/dist/bundle/cli.js" "$fixture/bin/pi"
ln -s "$tmux" "$fixture/bin/tmux"
chmod 700 "$fixture/bin/"{curl,wget,npm,brew,apt-get,dnf,pacman}
# Copy only installed runtime distributions, not home/config/session data.
source "$repo/pi/runtime.sh"
[[ -x "$pi_node_dir/bin/node" && "$("$pi_node_dir/bin/node" --version)" == "v$pi_node_version" ]] || { echo 'Required pinned Node is not installed.' >&2; exit 1; }
mkdir -p "$fixture/runtime"
cp -R "$pi_node_dir" "$fixture/runtime/"
# Deny package installation even when a local npm cache could satisfy it.
rm -f "$fixture/runtime/$pi_node_name/bin/npm"
cp "$fixture/bin/npm" "$fixture/runtime/$pi_node_name/bin/npm"
source "$repo/pi/jq.sh"
[[ -x "$pi_jq_dir/jq" && "$("$pi_jq_dir/jq" --version)" == "jq-$pi_jq_version" ]] || { echo 'Required pinned jq is not installed.' >&2; exit 1; }
cp -R "$pi_jq_dir" "$fixture/runtime/"
printf '%s\n' "$pi_node_dir" "$pi_jq_dir" >> "$fixture/evidence/original-asset-roots.txt"
cp "$pi_jq_dir/jq" "$fixture/bin/jq"
# Ask the pinned upstream API for its executable distributions only.
"$node" - "$repo/pi/node_modules/playwright-core/lib/coreBundle.js" > "$fixture/evidence/browser-paths.txt" <<'NODE'
const {registry}=require(process.argv[2]).registry;
for(const name of ['chromium','chromium-headless-shell','ffmpeg']) {
  const entry=registry.findExecutable(name);
  if(!entry?.directory||!require('fs').existsSync(entry.executablePath()))throw new Error(`Missing pinned browser executable ${name}`);
  console.log(entry.directory);
}
NODE
while IFS= read -r distribution; do
  cp -R "$distribution" "$fixture/browsers/"
  printf '%s\n' "$distribution" >> "$fixture/evidence/original-asset-roots.txt"
done < "$fixture/evidence/browser-paths.txt"
# Only private fixture configuration differs: scripted model, guard, frozen adapter.
mkdir -p "$fixture/repo/pi/agent/extensions"
cat > "$fixture/repo/pi/agent/extensions/runtime-proof.ts" <<'TS'
import {appendFileSync} from 'node:fs';
import {join} from 'node:path';
export default function(pi) { pi.on('session_start', (_event,ctx)=>appendFileSync(join(process.env.PI_CODING_AGENT_DIR,'runtime-processes.jsonl'),JSON.stringify({time:Date.now(),pid:process.pid,cli:process.argv[1],node:process.execPath,mode:ctx.mode})+'\n')); }
TS
"$jq" -n '{defaultProvider:"fixture",defaultModel:"fixture",retry:{enabled:false},compaction:{enabled:false},enableInstallTelemetry:false,extensions:["./lifecycle/session-lifecycle.ts","./extensions/runtime-proof.ts"],packages:[{source:"../upstream/pi-interactive-subagents",skills:[],prompts:[],themes:[]}],prompts:[],skills:[]}' > "$fixture/repo/pi/agent/settings.json"
# No writable symlink can escape source/dependency/runtime snapshots.
for tree in "$fixture/repo" "$fixture/candidate" "$fixture/runtime" "$fixture/browsers"; do "$node" "$repo/pi/tests/t3-runtime/snapshot.mjs" audit "$tree"; done
bash "$fixture/repo/pi/rpc-readiness.sh" "$fixture/candidate" --check > "$fixture/evidence/readiness-check.txt" 2>&1
hash_sources > "$fixture/evidence/source.after.sha256"
"$node" "$repo/pi/tests/t3-runtime/snapshot.mjs" hash "$repo/pi/node_modules" "$repo/pi/upstream" "$candidate" > "$fixture/evidence/dependencies.after.sha256"
cmp "$fixture/evidence/source.before.sha256" "$fixture/evidence/source.after.sha256"
cmp "$fixture/evidence/dependencies.before.sha256" "$fixture/evidence/dependencies.after.sha256"
printf '%s\n' 'Prepared only; real bootstrap and runtime proof have not run.' > "$fixture/evidence/prepared.txt"

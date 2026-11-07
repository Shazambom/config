#!/usr/bin/env bash
# Installed CLI proof only. Never deploy globally or contact a real provider.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/command-path.sh"
cli="$(pi_real_command "$(command -v pi)")"
node="$(command -v node)"
proof="$(mktemp -d "${TMPDIR:-/tmp}/complaint-skills-runtime.XXXXXX")"
chmod 700 "$proof"
printf 'Proof artifacts: %s\n' "$proof"
normal_home="$HOME"
mkdir -p "$proof/home" "$proof/agent" "$proof/project/.git"
# A clean environment prevents inherited provider credentials, proxies and Node hooks.
run() {
  env -i PATH="$PATH" HOME="$proof/home" TMPDIR="${TMPDIR:-/tmp}" \
    PI_CODING_AGENT_DIR="$proof/agent" PI_OFFLINE=1 \
    "$@"
}
run bash "$repo/claude/setup.sh" > "$proof/setup.log" 2>&1
for skill in complaint address-complaint; do
  cmp "$repo/claude/skills/$skill/SKILL.md" "$proof/home/.claude/skills/$skill/SKILL.md"
done
run "$node" "$cli" --version | tee "$proof/version.txt"
cd "$proof/project"
if run "$node" "$repo/claude/tests/complaint-skills-runtime.mjs" "$cli" "$repo" "$normal_home" absent > "$proof/negative.log" 2>&1; then
  echo 'FAIL: absent-skills negative control unexpectedly passed' >&2
  exit 1
fi
grep -q 'Missing canonical skill command: skill:complaint' "$proof/negative.log"
echo 'PASS: absent-skills negative control failed at command discovery'
# Mutate only private copies: removing manual-only metadata must be detected.
for skill in complaint address-complaint; do
  file="$proof/home/.claude/skills/$skill/SKILL.md"
  cp "$file" "$proof/$skill.original"
  grep -v '^disable-model-invocation: true$' "$file" > "$proof/advertised"
  mv "$proof/advertised" "$file"
done
if run "$node" "$repo/claude/tests/complaint-skills-runtime.mjs" "$cli" "$repo" "$normal_home" > "$proof/advertised-negative.log" 2>&1; then
  echo 'FAIL: advertised-skills negative control unexpectedly passed' >&2
  exit 1
fi
grep -q 'Manual skill leaked into system catalog' "$proof/advertised-negative.log"
for skill in complaint address-complaint; do
  cp "$proof/$skill.original" "$proof/home/.claude/skills/$skill/SKILL.md"
done
echo 'PASS: removing manual-only metadata was rejected at the provider boundary'
run "$node" "$repo/claude/tests/complaint-skills-runtime.mjs" "$cli" "$repo" "$normal_home" > "$proof/runtime.log" 2>&1 || {
  printf 'FAIL: inspect %s/runtime.log\n' "$proof" >&2
  exit 1
}
printf 'PASS: installed CLI discovery, manual catalog exclusion, native expansion and short-name lookup. See %s/runtime.log\n' "$proof"

#!/usr/bin/env bash
# Contract and isolated seed checks only: no models, solver runs, or global deployment.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077
proof="$(mktemp -d "${TMPDIR:-/tmp}/pi-optimize-test.XXXXXX")"
trap 'printf "Pi optimize proof: %s\n" "$proof"' EXIT
source="$repo/claude/skills/pi-optimize"
# The public setup path must carry the complete reusable workflow into a fresh HOME.
HOME="$proof/home" bash "$repo/claude/setup.sh" > "$proof/setup.log" 2>&1
installed="$proof/home/.claude/skills/pi-optimize"
test -f "$installed/SKILL.md"
diff -r "$source" "$installed" > "$proof/seed.diff"
grep -Fxq 'name: pi-optimize' "$installed/SKILL.md"
grep -Fxq 'disable-model-invocation: true' "$installed/SKILL.md"
for text in 'positive integer' 'human invocation' 'falsifier' 'interaction' 'inconclusive' 'one actual solver attempt' 'approval' 'references/runbook.md'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'default' 'effective' 'activation' 'cache' 'ownership' 'timeline' 'incumbent' 'holdout' 'unknown' 'falsifier'; do
  grep -Fiq "$text" "$installed/references/runbook.md"
done
for text in 'What could I have done better?' 'First correct' 'no mandatory extra' 'Snapshot and freeze' 'references/lessons.md' 'exact next configuration' 'completion-to-next-launch gap' 'while the next trial runs' 'Governing tenets' 'Apply KISS' 'Use TDD' 'ask the human if it cannot be verified'; do
  grep -Fiq "$text" "$installed/SKILL.md"
done
for text in 'omitted `ps`' 'npm root -g' 'foreground' 'apostrophes' 'checksum file' 'Announce verified readiness'; do
  grep -Fq "$text" "$installed/references/lessons.md"
done
for text in 'Saturation and cost-aware benchmark screening' 'Pi 10, Codex 10' 'enforcement versus estimate' 'not statistical proof' 'before code escalation'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'Candidate feasibility' 'censored' 'New-baseline handoff' 'per-trial' 'saturation'; do
  grep -Fiq "$text" "$installed/references/runbook.md"
done
for text in 'Sequential by default' 'review BOTH' 'same frozen harness/profile' 'concurrency timing confound' 'task applicability' 'toolsAdded' 'package HOLD'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'aggregate' 'both results' 'HOLD' 'promptSnippet'; do
  grep -Fq "$text" "$installed/references/runbook.md"
done
for text in 'Bash-only' 'toolsRemoved' 'raw MCP' 'HOLD selections'; do
  grep -Fq "$text" "$installed/references/lessons.md"
done
for text in 'Top-of-session invariant register' 'Never automatically tune reasoning effort' 'experiment-variable allowlist' 'protocol-invalid' 'no refund'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'Invariant | Value | Human source' 'Effective override / precedence | Proof' 'Before EVERY launch' 'recorded actual values'; do
  grep -Fq "$text" "$installed/references/runbook.md"
done
if grep -Fq 'Reasoning level is a configuration factor that can vary' "$installed/SKILL.md" ||
   grep -Fq 'reasoning-level baseline and fairness labels for later variants' "$installed/references/runbook.md"; then
  printf 'FAIL: reasoning-effort tuning contradicts human invariants\n' >&2
  exit 1
fi
for text in 'compressed historical optimization log' 'READ history before' 'index, not a replacement' 'never retry merely because' 'retest condition'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'Authoritative history index' 'Retest condition' 'spent / unused' 'evidence links'; do
  grep -Fq "$text" "$installed/references/runbook.md"
done
for text in 'config-first change' 'not automatic permission to repeat' 'substantive genuine human process correction' 'automation/advisory messages are not human instructions'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'Config-first next action' 'Human correction captured'; do
  grep -Fq "$text" "$installed/references/runbook.md"
done
if grep -Fq 'An inconclusive result motivates a repeat/control' "$installed/SKILL.md"; then
  printf 'FAIL: automatic repeat priority contradicts config-first direction\n' >&2
  exit 1
fi
for text in 'benchmark-by-configuration matrix' 'Prepare eligible batch cells BEFORE launch' 'not an exhaustive Cartesian product' 'invalid cells are not controls'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'Benchmark × configuration matrix' 'RAM / CPU fit' 'valid completed' 'source/image qualification'; do
  grep -Fq "$text" "$installed/references/runbook.md"
done
for text in 'shell configuration side effects' 'actual native-tool input/output' 'UTF-8' 'no paid performance evidence'; do
  grep -Fq "$text" "$installed/references/lessons.md"
done
for text in 'After EACH completed batch' 'top 2–4' 'testing priority' 'partial batch'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'Batch completion brief' 'valid baseline' 'remaining budget'; do
  grep -Fq "$text" "$installed/references/runbook.md"
done
for text in 'Drop no-effect configurations' 'Discard clear harm immediately' 'active recommendations' 'archived, not ranked'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'Drop / discard decision' 'changed-condition reopening'; do
  grep -Fq "$text" "$installed/references/runbook.md"
done
for text in 'On-deck table' 'exact delta' 'selected versus conditional' 'Report promptly with available evidence'; do
  grep -Fq "$text" "$installed/SKILL.md"
done
for text in 'Ranked retained changes' 'On-deck' 'Target batch / tasks' 'Readiness / blocker' 'no global promotion'; do
  grep -Fq "$text" "$installed/references/runbook.md"
done
grep -Fq 'explicit human apply request' "$installed/SKILL.md"
grep -Fq 'rather than stale hardcoded values' "$installed/references/lessons.md"
# Tiny Node bridge exercises Pi's installed JS API; it does not call a provider.
source "$repo/pi/command-path.sh"
cli="$(pi_real_command "$(command -v pi)")"
# npm's prefix may belong to another Node installation. Follow the selected CLI.
api_root="$(dirname -- "$cli")"
while [[ ! -f "$api_root/core/skills.js" && "$api_root" != / ]]; do
  api_root="$(dirname -- "$api_root")"
done
skills_api="$api_root/core/skills.js"
test -f "$skills_api"
printf 'Selected CLI: %s\nSkills API: %s\n' "$cli" "$skills_api" > "$proof/runtime.txt"
env -i PATH="$PATH" HOME="$proof/home" PI_OFFLINE=1 node "$cli" --version >> "$proof/runtime.txt"
HOME="$proof/home" node --input-type=module - "$skills_api" "$installed" > "$proof/discovery.log" <<'NODE'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { loadSkillsFromDir, formatSkillsForPrompt } = await import(pathToFileURL(process.argv[2]).href);
const { skills, diagnostics } = loadSkillsFromDir({ dir: process.argv[3], source: 'test' });
assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics));
assert.equal(skills.length, 1);
assert.equal(skills[0].name, 'pi-optimize');
assert.equal(skills[0].disableModelInvocation, true);
assert.equal(formatSkillsForPrompt(skills), '');
console.log('PASS: installed Pi parser discovers manual skill and excludes automatic prompt catalog');
NODE
# Seeding must preserve local edits and be idempotent for the other bundled files.
printf '\nLocal customization\n' >> "$installed/SKILL.md"
cp "$installed/SKILL.md" "$proof/custom.md"
HOME="$proof/home" bash "$repo/claude/setup.sh" >> "$proof/setup.log" 2>&1
cmp "$proof/custom.md" "$installed/SKILL.md"
cmp "$source/references/runbook.md" "$installed/references/runbook.md"
cmp "$source/references/lessons.md" "$installed/references/lessons.md"
# Documented opt-in update: archive the whole skill outside discovery, then seed.
mkdir -m 700 "$proof/home/.claude/pi-optimize-backup-test"
mv "$installed" "$proof/home/.claude/pi-optimize-backup-test/pi-optimize"
HOME="$proof/home" bash "$repo/claude/setup.sh" >> "$proof/setup.log" 2>&1
diff -r "$source" "$installed" > "$proof/reseed.diff"
cmp "$proof/custom.md" "$proof/home/.claude/pi-optimize-backup-test/pi-optimize/SKILL.md"
# A preexisting destination, including a symlink, must not be replaced.
mkdir -p "$proof/symlink-home/.claude/skills" "$proof/external"
printf 'External skill\n' > "$proof/external/SKILL.md"
ln -s "$proof/external" "$proof/symlink-home/.claude/skills/pi-optimize"
HOME="$proof/symlink-home" bash "$repo/claude/setup.sh" >> "$proof/setup.log" 2>&1
test -L "$proof/symlink-home/.claude/skills/pi-optimize"
grep -Fxq 'External skill' "$proof/external/SKILL.md"
printf 'PASS: manual-only contract, argument/method coverage, fresh seed, installed Pi discovery/catalog exclusion, idempotence, customization, archive/reseed update and symlink preservation.\n'

#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/timeline-setup.XXXXXX")"
trap 'rm -rf "$work"' EXIT
export HOME="$work/home"
source_skill="$repo/claude/skills/timeline"
target="$HOME/.claude/skills/timeline"
bash "$repo/claude/setup.sh"
diff -qr "$source_skill" "$target"
bash "$repo/claude/setup.sh"
diff -qr "$source_skill" "$target"
# Upgrade only the exact automatic-invocation bundle, retaining a private backup.
cp "$repo/claude/tests/fixtures/timeline-auto-v1.txt" "$target/SKILL.md"
bash "$repo/claude/setup.sh"
cmp "$repo/claude/tests/fixtures/timeline-auto-v1.txt" "$HOME/.claude/timeline-skill-backup-auto-v1/timeline/SKILL.md"
diff -qr "$source_skill" "$target"
# Exercise Pi's parser and prompt formatter, not just a frontmatter grep.
node --input-type=module - "$repo" "$target" <<'JS'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { loadSkillsFromDir, formatSkillsForPrompt } = await import(pathToFileURL(`${process.argv[2]}/pi/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js`));
const { skills, diagnostics } = loadSkillsFromDir({ dir: process.argv[3], source: 'user' });
assert.equal(diagnostics.length, 0);
assert.equal(skills.length, 1);
assert.equal(skills[0].name, 'timeline');
assert.equal(skills[0].disableModelInvocation, true);
assert.equal(formatSkillsForPrompt(skills), '');
JS
printf '\nLocal customization\n' >> "$target/SKILL.md"
cp "$target/SKILL.md" "$work/custom.md"
bash "$repo/claude/setup.sh"
cmp "$work/custom.md" "$target/SKILL.md"
mv "$target" "$work/external"
ln -s "$work/external" "$target"
bash "$repo/claude/setup.sh"
[[ -L "$target" ]]
cmp "$work/custom.md" "$work/external/SKILL.md"
rm "$target"
ln -s "$work/absent" "$target"
bash "$repo/claude/setup.sh"
[[ -L "$target" && ! -e "$work/absent" ]]
printf '%s\n' 'PASS: timeline fresh seed, manual-only migration, native prompt exclusion, idempotence, customization, existing and dangling symlink preservation.'

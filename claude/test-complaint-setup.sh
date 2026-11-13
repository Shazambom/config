#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/complaint-setup.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
source_skill="$repo/claude/skills/complaint"
fixture="$repo/claude/tests/fixtures/complaint-defects-v1.txt"
new_case() {
  export HOME="$work/$1"
  target="$HOME/.claude/skills/complaint"
  backup="$HOME/.claude/complaint-skill-backup-wishes-v1"
  mkdir -p "$target/scripts"
  cp "$fixture" "$target/SKILL.md"
}
new_case upgrade
printf 'local helper\n' > "$target/scripts/local.txt"
bash "$repo/claude/setup.sh"
grep -q 'magic wand' "$target/SKILL.md"
grep -q 'A bug is not required' "$target/SKILL.md"
cmp "$source_skill/SKILL.md" "$target/SKILL.md"
cmp "$fixture" "$backup/SKILL.md"
test "$(cat "$target/scripts/local.txt")" = 'local helper'
# Approval, explicit invocation and persistence rules must be byte-identical.
sed -n '/^## Approval comes before any complaint file/,$p' "$fixture" > "$work/approval-before"
sed -n '/^## Approval comes before any complaint file/,$p' "$target/SKILL.md" > "$work/approval-after"
cmp "$work/approval-before" "$work/approval-after"
grep -q '^disable-model-invocation: true$' "$target/SKILL.md"
test ! -e "$HOME/.pi/complaints"
bash "$repo/claude/setup.sh"
cmp "$fixture" "$backup/SKILL.md"
cmp "$source_skill/SKILL.md" "$target/SKILL.md"
new_case customized
printf '\nLocal customization\n' >> "$target/SKILL.md"
cp "$target/SKILL.md" "$work/custom.txt"
bash "$repo/claude/setup.sh"
cmp "$work/custom.txt" "$target/SKILL.md"
test ! -e "$backup"
new_case conflict
mkdir "$backup"
bash "$repo/claude/setup.sh"
cmp "$fixture" "$target/SKILL.md"
new_case symlink
mv "$target/SKILL.md" "$work/external.txt"
ln -s "$work/external.txt" "$target/SKILL.md"
bash "$repo/claude/setup.sh"
test -L "$target/SKILL.md"
cmp "$fixture" "$work/external.txt"
new_case directory-link
mv "$target" "$work/external-skill"
ln -s "$work/external-skill" "$target"
bash "$repo/claude/setup.sh"
test -L "$target"
cmp "$fixture" "$target/SKILL.md"
new_case fresh
rm -rf "$target"
bash "$repo/claude/setup.sh"
diff -qr "$source_skill" "$target"
test ! -e "$HOME/.pi/complaints"
printf '%s\n' 'PASS: complaint wishes, unchanged approval gate, upgrade/backup, helper preservation, idempotence, customization, symlink protection and fresh seed.'

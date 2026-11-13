#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/how-setup.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
source_skill="$repo/claude/skills/how"
fixture="$repo/claude/tests/fixtures/how-scope-v1.txt"
new_case() {
  export HOME="$work/$1"
  target="$HOME/.claude/skills/how"
  backup="$HOME/.claude/how-skill-backup-scope-v1"
  mkdir -p "$target/references"
  cp "$fixture" "$target/SKILL.md"
}
new_case upgrade
printf 'custom reference\n' > "$target/references/local.txt"
bash "$repo/claude/setup.sh"
grep -Fx 'Identify the scope. If plausible interpretations would require materially different investigations, clarify before delegating. Otherwise state a bounded interpretation and proceed.' "$target/SKILL.md"
cmp "$source_skill/SKILL.md" "$target/SKILL.md"
cmp "$fixture" "$backup/SKILL.md"
test "$(cat "$target/references/local.txt")" = 'custom reference'
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
printf '%s\n' 'PASS: how scope upgrade, backup, reference preservation, idempotence, customization, backup conflict, symlinks and fresh seed.'

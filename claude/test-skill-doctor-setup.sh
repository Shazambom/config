#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/skill-doctor-setup.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
export HOME="$work/home"
source_skill="$repo/claude/skills/skill-doctor"
target="$HOME/.claude/skills/skill-doctor"
mkdir -p "$target"
cp "$source_skill/SKILL.md" "$target/SKILL.md"
bash "$repo/claude/setup.sh"
test -f "$target/scripts/collect_sessions.py"
diff -qr "$source_skill" "$target"
cmp "$source_skill/SKILL.md" "$HOME/.claude/skill-doctor-backup-markdown-v1/skill-doctor/SKILL.md"
bash "$repo/claude/setup.sh"
diff -qr "$source_skill" "$target"
rm -rf "$target"
mkdir "$target"
printf 'custom\n' > "$target/SKILL.md"
bash "$repo/claude/setup.sh"
test "$(cat "$target/SKILL.md")" = custom
test ! -e "$target/scripts"
rm -rf "$target"
ln -s "$work/absent" "$target"
bash "$repo/claude/setup.sh"
test -L "$target"
test ! -e "$work/absent"
rm "$target"
bash "$repo/claude/setup.sh"
diff -qr "$source_skill" "$target"
python3 "$target/scripts/collect_sessions.py" --help >/dev/null
printf '%s\n' 'PASS: skill-doctor upgrade, backup, idempotence, customization, symlink protection, fresh install and collector entry point.'

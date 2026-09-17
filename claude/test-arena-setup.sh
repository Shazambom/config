#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/arena-setup-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT
export HOME="$work/home"
target="$HOME/.claude/skills/arena"
backup="$HOME/.claude/arena-skill-backup-86f1583"
git -C "$repo" show 86f15832c5e0d80bd07006da665f5ab4e6c8212c:claude/skills/arena/SKILL.md > "$work/old.md"
reset_old() {
  rm -rf "$HOME"
  mkdir -p "$target"
  cp "$work/old.md" "$target/SKILL.md"
}
reset_old
bash "$repo/claude/setup.sh"
cmp "$work/old.md" "$backup/arena/SKILL.md"
cmp "$repo/claude/skills/arena/SKILL.md" "$target/SKILL.md"
permissions="$(ls -ld "$backup")"
[[ "${permissions:0:10}" == drwx------ ]]
bash "$repo/claude/setup.sh"
cmp "$work/old.md" "$backup/arena/SKILL.md"
cmp "$repo/claude/skills/arena/SKILL.md" "$target/SKILL.md"
for mode in customized extra symlink backup parent-link; do
  reset_old
  case "$mode" in
    customized) printf '\nCustom policy\n' >> "$target/SKILL.md" ;;
    extra) mkdir "$target/private-notes" ;;
    symlink) rm "$target/SKILL.md"; ln -s "$work/old.md" "$target/SKILL.md" ;;
    backup) mkdir "$backup" ;;
    parent-link) mv "$HOME/.claude/skills" "$work/linked-skills"; ln -s "$work/linked-skills" "$HOME/.claude/skills" ;;
  esac
  cp "$target/SKILL.md" "$work/expected.md"
  bash "$repo/claude/setup.sh"
  cmp "$work/expected.md" "$target/SKILL.md"
  [[ ! -e "$backup/arena" ]]
  [[ "$mode" != symlink || -L "$target/SKILL.md" ]]
done
printf '%s\n' 'PASS: arena exact-bundle migration, private backup, idempotence, custom content and symlink preservation.'

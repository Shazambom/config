#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/code-review-setup.XXXXXX")"
trap 'rm -rf "$work"' EXIT
legacy="${CODE_REVIEW_LEGACY_FIXTURE:-}"
export HOME="$work/home"
source_skill="$repo/claude/skills/code-review"
target="$HOME/.claude/skills/code-review"
command_path="$HOME/.claude/commands/code-review.md"
bash "$repo/claude/setup.sh"
diff -qr "$source_skill" "$target"
cmp "$repo/claude/commands/code-review.md" "$command_path"
for ref in levels scope angles actions origin; do
  [[ -s "$target/references/$ref.md" ]]
  grep -Fq "references/$ref.md" "$target/SKILL.md"
done
bash "$repo/claude/setup.sh"
diff -qr "$source_skill" "$target"
printf '\nCustom review policy\n' >> "$target/SKILL.md"
printf 'Custom command\n' > "$command_path"
rm "$target/references/angles.md"
cp "$target/SKILL.md" "$work/custom-skill"
bash "$repo/claude/setup.sh"
cmp "$work/custom-skill" "$target/SKILL.md"
[[ ! -e "$target/references/angles.md" ]]
[[ "$(< "$command_path")" == 'Custom command' ]]
rm -rf "$target"
mkdir "$work/external"
printf 'External skill\n' > "$work/external/SKILL.md"
ln -s "$work/external" "$target"
rm "$command_path"
printf 'External command\n' > "$work/external-command"
ln -s "$work/external-command" "$command_path"
bash "$repo/claude/setup.sh"
[[ -L "$target" && -L "$command_path" ]]
[[ "$(< "$target/SKILL.md")" == 'External skill' ]]
[[ "$(< "$command_path")" == 'External command' ]]
printf '%s\n' 'PASS: code-review skill, references and alias seed correctly; repeated setup preserves customizations, missing references and symlinks.'
if [[ -n "$legacy" ]]; then
  [[ -d "$legacy" ]]
  backup="$HOME/.claude/code-review-skill-backup-seed-v1"
  for mode in exact custom extra symlink conflict; do
    rm -rf "$HOME"
    mkdir -p "$HOME/.claude/skills"
    cp -R "$legacy" "$target"
    case "$mode" in
      custom) printf '\nCustom policy\n' >> "$target/SKILL.md" ;;
      extra) mkdir "$target/notes" ;;
      symlink) rm "$target/references/angles.md"; ln -s "$legacy/references/angles.md" "$target/references/angles.md" ;;
      conflict) mkdir "$backup" ;;
    esac
    rm -rf "$work/expected"
    cp -R "$target" "$work/expected"
    bash "$repo/claude/setup.sh"
    if [[ "$mode" == exact ]]; then
      diff -qr "$legacy" "$backup/code-review"
      diff -qr "$source_skill" "$target"
      [[ -n "$(find "$backup" -prune -perm 700 -print)" ]]
      bash "$repo/claude/setup.sh"
      diff -qr "$source_skill" "$target"
    else
      diff -qr "$work/expected" "$target"
      [[ ! -e "$backup/code-review" ]]
    fi
  done
  printf '%s\n' 'PASS: supplied legacy bundle migrates with a private backup; customizations, extra content, symlinks and backup conflicts are preserved.'
fi

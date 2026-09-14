#!/usr/bin/env bash
set -euo pipefail
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
destination="$HOME/.claude"
mkdir -p "$destination/skills" "$destination/commands"

migrate_bundled_design() {
  local target="$destination/skills/design"
  local backup="$destination/design-skill-backup-d404be7"
  local entry count=0 digest
  [[ ! -L "$destination" && ! -L "$destination/skills" ]] || return 0
  [[ -d "$target" && ! -L "$target" ]] || return 0
  [[ ! -e "$backup" && ! -L "$backup" ]] || return 0
  # Only the exact two-file bundle from d404be7 qualifies for this migration.
  while IFS= read -r -d '' entry; do
    [[ ! -L "$entry" ]] || return 0
    case "${entry#"$target/"}" in
      SKILL.md|references/document.md) [[ -f "$entry" ]] || return 0 ;;
      references) [[ -d "$entry" ]] || return 0 ;;
      *) return 0 ;;
    esac
    count=$((count + 1))
  done < <(find "$target" -mindepth 1 -print0)
  [[ "$count" == 3 ]] || return 0
  if command -v shasum >/dev/null 2>&1; then
    digest="$(shasum -a 256 < "$target/SKILL.md")" || return 0
    [[ "${digest%% *}" == 398d2e07b4f43c637e85f1d86f1e5b095574c5d1545143ec0a63a16301d6390a ]] || return 0
    digest="$(shasum -a 256 < "$target/references/document.md")" || return 0
  elif command -v sha256sum >/dev/null 2>&1; then
    digest="$(sha256sum < "$target/SKILL.md")" || return 0
    [[ "${digest%% *}" == 398d2e07b4f43c637e85f1d86f1e5b095574c5d1545143ec0a63a16301d6390a ]] || return 0
    digest="$(sha256sum < "$target/references/document.md")" || return 0
  else
    return 0
  fi
  [[ "${digest%% *}" == bc4cae697d1d7d85de35172f1ba11c5118b0d08b61720e4cde5f27c7a30b6373 ]] || return 0
  [[ -f "$source_root/skills/design/SKILL.md" ]] || return 0
  if cmp -s "$target/SKILL.md" "$source_root/skills/design/SKILL.md" &&
    cmp -s "$target/references/document.md" "$source_root/skills/design/references/document.md"; then
    return 0
  fi
  # mkdir reserves a private backup outside skill discovery; never reuse one.
  mkdir -m 700 "$backup" || return 0
  mv "$target" "$backup/design"
  printf 'Backed up bundled design skill to %s\n' "$backup/design"
}
migrate_bundled_design

for source in "$source_root/skills"/*; do
  [[ -d "$source" ]] || continue
  target="$destination/skills/${source##*/}"
  [[ ! -e "$target" && ! -L "$target" ]] || continue
  mkdir "$target"
  cp -R "$source/." "$target/"
done
while IFS= read -r -d '' source; do
  relative="${source#"$source_root/commands/"}"
  target="$destination/commands/$relative"
  [[ ! -e "$target" && ! -L "$target" ]] || continue
  mkdir -p "$(dirname -- "$target")"
  cp -n "$source" "$target"
done < <(find "$source_root/commands" -type f -name '*.md' -print0)

#!/usr/bin/env bash
set -euo pipefail
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
destination="$HOME/.claude"
mkdir -p "$destination/skills" "$destination/commands"
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

#!/usr/bin/env bash
# Link every bundled skill and command into $HOME/.claude so a `git pull` of this
# repo updates them in place. For headless hosts (shazam) that never edit skills
# locally; interactive machines keep using setup.sh, which copies and preserves
# local edits. Entries that are not symlinks into this repo are left alone, and
# links to skills or commands this repo no longer has are removed.
# Usage: claude/link.sh            (run after `git pull`; idempotent)
set -euo pipefail
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
destination="${CLAUDE_HOME:-$HOME/.claude}"
mkdir -p "$destination/skills" "$destination/commands"

link_entry() {
  local source="$1" target="$2"
  if [[ -L "$target" ]]; then
    [[ "$(readlink "$target")" == "$source" ]] && return 0
    case "$(readlink "$target")" in "$source_root"/*) ln -sfn "$source" "$target"; echo "relinked ${target#"$destination/"}" ;; esac
    return 0
  fi
  [[ -e "$target" ]] && return 0   # a real file or directory: not ours to touch
  ln -s "$source" "$target"
  echo "linked ${target#"$destination/"}"
}

for source in "$source_root/skills"/*/; do
  source="${source%/}"
  link_entry "$source" "$destination/skills/${source##*/}"
done
while IFS= read -r -d '' source; do
  relative="${source#"$source_root/commands/"}"
  mkdir -p "$(dirname -- "$destination/commands/$relative")"
  link_entry "$source" "$destination/commands/$relative"
done < <(find "$source_root/commands" -type f -name '*.md' -print0)

# Drop links into this repo whose source is gone (skill or command removed upstream).
while IFS= read -r -d '' link; do
  resolved="$(readlink "$link")"
  case "$resolved" in "$source_root"/*) [[ -e "$resolved" ]] || { rm "$link"; echo "removed stale ${link#"$destination/"}"; } ;; esac
done < <(find "$destination/skills" "$destination/commands" -maxdepth 2 -type l -print0)

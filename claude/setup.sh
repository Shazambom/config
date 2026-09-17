#!/usr/bin/env bash
set -euo pipefail
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
destination="$HOME/.claude"
mkdir -p "$destination/skills" "$destination/commands"

migrate_bundled_design() {
  local target="$destination/skills/design"
  local backup version document skill_hash document_hash support_hash
  local entry count=0 expected=3 digest
  local -a hash_command
  [[ ! -L "$destination" && ! -L "$destination/skills" ]] || return 0
  [[ -d "$target" && ! -L "$target" ]] || return 0
  [[ -f "$target/SKILL.md" && ! -L "$target/SKILL.md" ]] || return 0
  if command -v shasum >/dev/null 2>&1; then
    hash_command=(shasum -a 256)
  elif command -v sha256sum >/dev/null 2>&1; then
    hash_command=(sha256sum)
  else
    return 0
  fi
  digest="$("${hash_command[@]}" < "$target/SKILL.md")" || return 0
  while read -r version document skill_hash document_hash support_hash; do
    [[ "${digest%% *}" != "$skill_hash" ]] || break
  done <<'BUNDLES'
d404be7 references/document.md 398d2e07b4f43c637e85f1d86f1e5b095574c5d1545143ec0a63a16301d6390a bc4cae697d1d7d85de35172f1ba11c5118b0d08b61720e4cde5f27c7a30b6373
09ec53b references/document.txt 6ebcb7575b4bb93b51752946ccdf815c418dc501c55d97550cad75a4d00562bb 88778548c6e54f548bffce803e5379ea9e8216cc9d81fb4812f423b80b97aff3
go-contracts-v1 references/design.go.txt cda433c97cc8ff47c3b21b75f5363525dd98567ad8d8b53ddf27c5f20545f4d1 b81e2a8bb59fdc0730c902cfeabcc3deb095e542be2805b1468d10017e011747
flow-first-v1 references/design.go.txt 02cb99d025d6e58a3a692a58e9d89b7a12cabda3f6d561f39e1ad67154eccf64 5cdd415093d2b83fbb6dd14f6a5be490009b9b7238346712c312a0a730dc05b6 d92f099440ba8791b3d10e5ad3615770c37389baf9b27b253d696355b734b2cd
pseudocode-v1 references/design.go.txt 072b873d06a357f5dc475090e7fc9869bec08ca55176fe797f6a99020ddba4ea f480db7e295f5d6bacb1e74da6ba242f43c3571f9cb0e4c0f0c855eff3d54073 d92f099440ba8791b3d10e5ad3615770c37389baf9b27b253d696355b734b2cd
BUNDLES
  [[ "${digest%% *}" == "$skill_hash" ]] || return 0
  backup="$destination/design-skill-backup-$version"
  [[ ! -e "$backup" && ! -L "$backup" ]] || return 0
  [[ -z "$support_hash" ]] || expected=4
  while IFS= read -r -d '' entry; do
    [[ ! -L "$entry" ]] || return 0
    case "${entry#"$target/"}" in
      SKILL.md|"$document") [[ -f "$entry" ]] || return 0 ;;
      references/support.go.txt) [[ -n "$support_hash" && -f "$entry" ]] || return 0 ;;
      references) [[ -d "$entry" ]] || return 0 ;;
      *) return 0 ;;
    esac
    count=$((count + 1))
  done < <(find "$target" -mindepth 1 -print0)
  [[ "$count" == "$expected" ]] || return 0
  digest="$("${hash_command[@]}" < "$target/$document")" || return 0
  [[ "${digest%% *}" == "$document_hash" ]] || return 0
  if [[ -n "$support_hash" ]]; then
    digest="$("${hash_command[@]}" < "$target/references/support.go.txt")" || return 0
    [[ "${digest%% *}" == "$support_hash" ]] || return 0
  fi
  [[ -f "$source_root/skills/design/SKILL.md" ]] || return 0
  if diff -qr "$target" "$source_root/skills/design" >/dev/null; then
    return 0
  fi
  # mkdir reserves a private backup outside skill discovery; never reuse one.
  mkdir -m 700 "$backup" || return 0
  mv "$target" "$backup/design"
  printf 'Backed up bundled design skill to %s\n' "$backup/design"
}
migrate_bundled_design

migrate_bundled_arena() {
  local target="$destination/skills/arena" backup="$destination/arena-skill-backup-86f1583" digest
  local -a hash_command
  [[ ! -L "$destination" && ! -L "$destination/skills" ]] || return 0
  [[ -d "$target" && ! -L "$target" && -f "$target/SKILL.md" && ! -L "$target/SKILL.md" ]] || return 0
  [[ ! -e "$backup" && ! -L "$backup" ]] || return 0
  [[ -z "$(find "$target" -mindepth 1 ! -path "$target/SKILL.md" -print -quit)" ]] || return 0
  if command -v shasum >/dev/null 2>&1; then
    hash_command=(shasum -a 256)
  elif command -v sha256sum >/dev/null 2>&1; then
    hash_command=(sha256sum)
  else
    return 0
  fi
  digest="$("${hash_command[@]}" < "$target/SKILL.md")" || return 0
  [[ "${digest%% *}" == 7a637b50e6acea6937679c5bb8f89624306f8f26fa8544c924fac243107c2278 ]] || return 0
  [[ -f "$source_root/skills/arena/SKILL.md" ]] || return 0
  cmp -s "$target/SKILL.md" "$source_root/skills/arena/SKILL.md" && return 0
  mkdir -m 700 "$backup" || return 0
  mv "$target" "$backup/arena"
  printf 'Backed up bundled arena skill to %s\n' "$backup/arena"
}
migrate_bundled_arena

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

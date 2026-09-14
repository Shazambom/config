#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/claude-setup-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
export HOME="$test_dir/home"
mkdir -p "$HOME" "$test_dir/bundle" "$test_dir/old/references"
cp -R "$repo/claude/." "$test_dir/bundle/"
git -C "$repo" show d404be7653bdc50c60bdfcb679292d3458821001:claude/skills/design/SKILL.md > "$test_dir/old/SKILL.md"
git -C "$repo" show d404be7653bdc50c60bdfcb679292d3458821001:claude/skills/design/references/document.md > "$test_dir/old/references/document.md"
# A fixture update keeps this test independent of future bundled content.
printf '\nFixture update\n' >> "$test_dir/bundle/skills/design/SKILL.md"
target="$HOME/.claude/skills/design"
backup="$HOME/.claude/design-skill-backup-d404be7"
setup() { bash "$test_dir/bundle/setup.sh"; }
reset_old() {
  rm -rf "$HOME/.claude"
  mkdir -p "$target"
  cp -R "$test_dir/old/." "$target/"
}
unchanged() {
  diff -r "$test_dir/expected" "$target"
  [[ ! -e "$backup" && ! -L "$backup" ]]
}
expect_unchanged() {
  rm -rf "$test_dir/expected"
  cp -R "$target" "$test_dir/expected"
  setup
  unchanged
  setup
  unchanged
}

setup
diff -r "$test_dir/bundle/skills/design" "$target"
[[ ! -e "$backup" ]]
setup
diff -r "$test_dir/bundle/skills/design" "$target"

reset_old
setup
diff -r "$test_dir/old" "$backup/design"
diff -r "$test_dir/bundle/skills/design" "$target"
permissions="$(ls -ld "$backup")"
[[ "${permissions:0:10}" == drwx------ ]]
setup
diff -r "$test_dir/old" "$backup/design"
diff -r "$test_dir/bundle/skills/design" "$target"

for file in SKILL.md references/document.md; do
  reset_old
  printf '\nUser customization\n' >> "$target/$file"
  expect_unchanged
done
for extra in .custom references/extra.md empty-dir; do
  reset_old
  if [[ "$extra" == empty-dir ]]; then mkdir "$target/$extra"; else : > "$target/$extra"; fi
  expect_unchanged
done
reset_old
rm "$target/references/document.md"
expect_unchanged

# Symlinks, including dangling ones, must never qualify for migration.
for link in SKILL.md references/document.md references; do
  reset_old
  rm -rf "$target/$link"
  ln -s "$test_dir/old/$link" "$target/$link"
  setup
  [[ -L "$target/$link" && ! -e "$backup" ]]
done
for link_destination in "$test_dir/old" "$test_dir/missing"; do
  reset_old
  rm -rf "$target"
  ln -s "$link_destination" "$target"
  setup
  [[ -L "$target" && "$(readlink "$target")" == "$link_destination" && ! -e "$backup" ]]
done
reset_old
ln -s "$test_dir/missing" "$target/extra"
setup
[[ -L "$target/extra" && ! -e "$backup" ]]

for parent in skills .claude; do
  reset_old
  rm -rf "$test_dir/linked-parent"
  if [[ "$parent" == skills ]]; then
    mv "$HOME/.claude/skills" "$test_dir/linked-parent"
    ln -s "$test_dir/linked-parent" "$HOME/.claude/skills"
  else
    mv "$HOME/.claude" "$test_dir/linked-parent"
    ln -s "$test_dir/linked-parent" "$HOME/.claude"
  fi
  setup
  diff -r "$test_dir/old" "$target"
  [[ ! -e "$backup" ]]
done

# Existing backups are never reused, even if empty or dangling.
for kind in directory file symlink; do
  reset_old
  case "$kind" in
    directory) mkdir "$backup" ;;
    file) printf 'keep\n' > "$backup" ;;
    symlink) ln -s "$test_dir/missing" "$backup" ;;
  esac
  setup
  diff -r "$test_dir/old" "$target"
  case "$kind" in
    directory) [[ -d "$backup" && -z "$(ls -A "$backup")" ]] ;;
    file) [[ "$(< "$backup")" == keep ]] ;;
    symlink) [[ -L "$backup" && "$(readlink "$backup")" == "$test_dir/missing" ]] ;;
  esac
done

# No migration when the source still contains the known old bundle.
reset_old
rm -rf "$test_dir/bundle/skills/design"
cp -R "$test_dir/old" "$test_dir/bundle/skills/design"
expect_unchanged
printf '%s\n' 'PASS: fresh seed, exact design migration, private backup, customizations, symlinks, backup conflicts and idempotence.'

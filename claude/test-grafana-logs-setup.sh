#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/grafana-logs-setup.XXXXXX")"
trap 'rm -rf "$work"' EXIT
# A separate candidate bundle keeps this test independent of instruction edits.
source_root="$work/source"
mkdir -p "$source_root/skills/grafana-logs" "$source_root/commands"
cp "$repo/claude/setup.sh" "$source_root/setup.sh"
old="$repo/claude/tests/fixtures/grafana-logs-v1.md"
cp "$old" "$source_root/skills/grafana-logs/SKILL.md"
printf '\nCandidate replacement for migration testing.\n' >> "$source_root/skills/grafana-logs/SKILL.md"
export HOME="$work/home"
reset_case() {
  rm -rf "$HOME"
  mkdir -p "$HOME/.claude/skills/grafana-logs"
  target="$HOME/.claude/skills/grafana-logs"
  backup="$HOME/.claude/grafana-logs-skill-backup-v1"
  cp "$old" "$target/SKILL.md"
}
run_setup() { bash "$source_root/setup.sh"; }
assert_preserved() {
  run_setup
  cmp "$old" "$target/SKILL.md"
  [[ ! -e "$backup" && ! -L "$backup" ]]
}
reset_case
run_setup
cmp "$source_root/skills/grafana-logs/SKILL.md" "$target/SKILL.md"
cmp "$old" "$backup/grafana-logs/SKILL.md"
[[ "$(find "$HOME/.claude/skills" -name SKILL.md | wc -l | tr -d ' ')" == 1 ]]
mode="$(stat -f '%Lp' "$backup" 2>/dev/null || stat -c '%a' "$backup")"
[[ "$mode" == 700 ]]
run_setup
cmp "$old" "$backup/grafana-logs/SKILL.md"
cmp "$source_root/skills/grafana-logs/SKILL.md" "$target/SKILL.md"
# Fresh installs and reruns.
rm -rf "$HOME"
run_setup
run_setup
cmp "$source_root/skills/grafana-logs/SKILL.md" "$target/SKILL.md"
[[ ! -e "$backup" ]]
# A still-old source is not an upgrade.
reset_case
cp "$source_root/skills/grafana-logs/SKILL.md" "$work/candidate.md"
cp "$old" "$source_root/skills/grafana-logs/SKILL.md"
assert_preserved
cp "$work/candidate.md" "$source_root/skills/grafana-logs/SKILL.md"
# Custom instructions, including an empty file, must survive.
for customization in edited empty; do
  reset_case
  if [[ "$customization" == edited ]]; then printf '\nLocal change\n' >> "$target/SKILL.md"; else : > "$target/SKILL.md"; fi
  cp "$target/SKILL.md" "$work/custom.md"
  run_setup
  cmp "$work/custom.md" "$target/SKILL.md"
  [[ ! -e "$backup" ]]
done
for extra in file directory hidden symlink; do
  reset_case
  case "$extra" in
    file) printf 'custom\n' > "$target/notes.md" ;;
    directory) mkdir "$target/references" ;;
    hidden) touch "$target/.custom" ;;
    symlink) ln -s "$work/missing" "$target/link" ;;
  esac
  cp -R "$target" "$work/expected"
  assert_preserved
  if [[ "$extra" == symlink ]]; then
    [[ -L "$target/link" && "$(readlink "$target/link")" == "$work/missing" ]]
  else
    diff -qr "$work/expected" "$target"
  fi
  rm -rf "$work/expected"
done
# Symlinks at every migration boundary, including dangling targets.
for boundary in skill file skills claude dangling; do
  reset_case
  external="$work/external-$boundary"
  case "$boundary" in
    skill) mv "$target" "$external"; ln -s "$external" "$target"; link="$target" ;;
    file) mv "$target/SKILL.md" "$external"; ln -s "$external" "$target/SKILL.md"; link="$target/SKILL.md" ;;
    skills) mv "$HOME/.claude/skills" "$external"; ln -s "$external" "$HOME/.claude/skills"; link="$HOME/.claude/skills" ;;
    claude) mv "$HOME/.claude" "$external"; ln -s "$external" "$HOME/.claude"; link="$HOME/.claude" ;;
    dangling) rm -rf "$target"; ln -s "$external" "$target"; link="$target" ;;
  esac
  run_setup
  [[ -L "$link" && ! -e "$backup" ]]
  if [[ "$boundary" == dangling ]]; then [[ ! -e "$external" ]]; else cmp "$old" "$target/SKILL.md"; fi
done
for collision in directory file symlink; do
  reset_case
  case "$collision" in
    directory) mkdir "$backup"; printf 'keep\n' > "$backup/marker" ;;
    file) printf 'keep\n' > "$backup" ;;
    symlink) ln -s "$work/missing-backup" "$backup" ;;
  esac
  run_setup
  cmp "$old" "$target/SKILL.md"
  case "$collision" in
    directory) [[ "$(< "$backup/marker")" == keep && ! -e "$backup/grafana-logs" ]] ;;
    file) [[ "$(< "$backup")" == keep ]] ;;
    symlink) [[ -L "$backup" && ! -e "$work/missing-backup" ]] ;;
  esac
done
printf '%s\n' 'PASS: grafana-logs exact migration, private backup, fresh seed, idempotence, unchanged source, customizations, extra entries, symlinks, backup collisions.'

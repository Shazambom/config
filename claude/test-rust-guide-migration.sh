#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/rust-guide-migration.XXXXXX")"
trap 'rm -rf "$work"' EXIT
export HOME="$work/home"
target="$HOME/.claude/skills/design"
backup="$HOME/.claude/design-skill-backup-rust-offline-v1"
cp -R "$repo/claude/skills/design" "$work/old"
awk '/^Format with / { print "Format with `rustfmt --edition 2021 design.rs support.rs`, omitting support if absent. From the isolated directory run `CARGO_NET_OFFLINE=true cargo check --offline --lib`. No dependencies may be fetched. Use rust-analyzer diagnostics if available, but do not install or configure editor tools during design. Report missing cargo, rustfmt, or rust-analyzer as unverified checks, not passes. Compilation checks declarations only, not the pseudocode or source-language equivalence."; exit } { print }' "$repo/claude/skills/design/references/rust.md" > "$work/old/references/rust.md"
reset_old() {
  rm -rf "$HOME"
  mkdir -p "$HOME/.claude/skills"
  cp -R "$work/old" "$target"
}
reset_old
bash "$repo/claude/setup.sh"
diff -r "$work/old" "$backup/design"
diff -r "$repo/claude/skills/design" "$target"
bash "$repo/claude/setup.sh"
diff -r "$repo/claude/skills/design" "$target"
for mode in skill guide extra excluded-name symlink backup; do
  reset_old
  case "$mode" in
    skill) printf '\nCustom policy\n' >> "$target/SKILL.md" ;;
    guide) printf '\nCustom guide\n' >> "$target/references/rust.md" ;;
    extra) mkdir "$target/private-notes" ;;
    excluded-name) printf 'custom\n' > "$target/rust.md" ;;
    symlink) rm "$target/references/rust.md"; ln -s "$work/old/references/rust.md" "$target/references/rust.md" ;;
    backup) mkdir "$backup" ;;
  esac
  rm -rf "$work/expected"
  cp -R "$target" "$work/expected"
  bash "$repo/claude/setup.sh"
  diff -r "$work/expected" "$target"
  [[ ! -e "$backup/design" ]]
  [[ "$mode" != symlink || -L "$target/references/rust.md" ]]
done
printf '%s\n' 'PASS: exact Rust guide update, full backup, idempotence, customization and symlink preservation.'

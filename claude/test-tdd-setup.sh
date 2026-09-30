#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077
work="$(mktemp -d /tmp/tdd-setup.XXXXXX)"
trap 'printf "TDD setup proof: %s\n" "$work"' EXIT
source="$repo/claude/commands/tdd.md"
awk '/^## Test quality$/ { skip=1; next } /^## Rules$/ { skip=0 } !skip' "$source" > "$work/legacy.md"
if command -v shasum >/dev/null; then digest="$(shasum -a 256 < "$work/legacy.md")"; else digest="$(sha256sum < "$work/legacy.md")"; fi
[[ "${digest%% *}" == 2aedb49d9fbf948623172e68af353648f73948278668f816fc1993e30b0ea595 ]]
body="$(awk 'BEGIN { delimiters=0 } /^---$/ { delimiters++; next } delimiters>=2 { print }' "$repo/pi/agent/extensions/prompt-snippets/snippets/meaningful-tests.md")"
grep -Fxq "$body" "$source"
run() { HOME="$work/$1" bash "$repo/claude/setup.sh" >> "$work/setup.log"; }
run fresh
cmp "$source" "$work/fresh/.claude/commands/tdd.md"
for fixture in legacy custom symlink conflict; do mkdir -p "$work/$fixture/.claude/commands"; done
cp "$work/legacy.md" "$work/legacy/.claude/commands/tdd.md"
run legacy
cmp "$source" "$work/legacy/.claude/commands/tdd.md"
backup="$work/legacy/.claude/tdd-command-backup-test-quality-v1"
cmp "$work/legacy.md" "$backup/tdd.md"
mode="$(stat -f '%Lp' "$backup" 2>/dev/null)" || mode="$(stat -c '%a' "$backup")"
[[ "$mode" == 700 ]]
run legacy
cmp "$source" "$work/legacy/.claude/commands/tdd.md"
cmp "$work/legacy.md" "$backup/tdd.md"
{ printf 'Custom instruction\n'; printf '%s\n' "$body"; } > "$work/custom.md"
cp "$work/custom.md" "$work/custom/.claude/commands/tdd.md"
run custom
cmp "$work/custom.md" "$work/custom/.claude/commands/tdd.md"
[[ ! -e "$work/custom/.claude/tdd-command-backup-test-quality-v1" ]]
cp "$work/legacy.md" "$work/external.md"
ln -s "$work/external.md" "$work/symlink/.claude/commands/tdd.md"
run symlink
[[ -L "$work/symlink/.claude/commands/tdd.md" ]]
cmp "$work/legacy.md" "$work/external.md"
cp "$work/legacy.md" "$work/conflict/.claude/commands/tdd.md"
printf 'Keep existing backup\n' > "$work/conflict/.claude/tdd-command-backup-test-quality-v1"
run conflict
cmp "$work/legacy.md" "$work/conflict/.claude/commands/tdd.md"
grep -Fxq 'Keep existing backup' "$work/conflict/.claude/tdd-command-backup-test-quality-v1"
printf 'PASS: exact snippet text, fresh setup, exact migration, private backup, idempotence, customization, symlink and backup preservation.\n'

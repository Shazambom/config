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
old_body='Write meaningful tests at every level. Assert the intended behavior, not merely that code ran or returned something. Check actual results against independently justified expectations, including relevant failure cases. Verify that the test fails when the behavior it protects is broken. Do not mock away the behavior being tested, weaken assertions to make a test pass, or change expected results without verifying the requirements. Do not cut corners or claim coverage the test does not provide.'
awk -v body="$old_body" '/^## Rules$/ { print "## Test quality\n\n" body "\n" } { print }' "$work/legacy.md" > "$work/quality-v1.md"
if command -v shasum >/dev/null; then digest="$(shasum -a 256 < "$work/quality-v1.md")"; else digest="$(sha256sum < "$work/quality-v1.md")"; fi
[[ "${digest%% *}" == 7cdd1aef3b4ce59d80f91ec8085bbc90c34d64d3b855e9cc29dee8b9dbc71d84 ]]
mkdir -p "$work/quality-v1/.claude/commands"
cp "$work/quality-v1.md" "$work/quality-v1/.claude/commands/tdd.md"
printf 'Keep older backup\n' > "$work/quality-v1/.claude/tdd-command-backup-test-quality-v1"
run quality-v1
cmp "$source" "$work/quality-v1/.claude/commands/tdd.md"
cmp "$work/quality-v1.md" "$work/quality-v1/.claude/tdd-command-backup-test-quality-v2/tdd.md"
grep -Fxq 'Keep older backup' "$work/quality-v1/.claude/tdd-command-backup-test-quality-v1"
run quality-v1
cmp "$source" "$work/quality-v1/.claude/commands/tdd.md"
cmp "$work/quality-v1.md" "$work/quality-v1/.claude/tdd-command-backup-test-quality-v2/tdd.md"
printf 'PASS: exact snippet text, fresh setup, both migrations, private backup, idempotence, customization, symlink and backup preservation.\n'

#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
project="$(cd "$test_dir/project" && pwd -P)"
mkdir -p "$project/.git" "$project/subdir/.claude/skills/local-fixture" \
  "$project/.claude/skills/project-fixture" "$test_dir/.claude/skills/outside-fixture"
for item in "$project/subdir/.claude/skills/local-fixture" \
  "$project/.claude/skills/project-fixture" "$test_dir/.claude/skills/outside-fixture"; do
  printf '%s\n' '---' "name: ${item##*/}" 'description: Discovery fixture' '---' 'Read references from this directory.' > "$item/SKILL.md"
done
cd "$project/subdir"
for mode in trusted untrusted disabled child; do
  mkfifo "$test_dir/$mode.in" "$test_dir/$mode.out"
  exec 3<> "$test_dir/$mode.in"
  exec 4<> "$test_dir/$mode.out"
  args=(--approve)
  case "$mode" in
    untrusted) args=(--no-approve) ;;
    disabled) args=(--approve --no-skills) ;;
    child) args=(--approve --no-extensions -e "$CONFIG_PI_HOME/agent/extensions/claude-skills.ts") ;;
  esac
  "$repo/pi.sh" --mode rpc --offline --no-session "${args[@]}" < "$test_dir/$mode.in" > "$test_dir/$mode.out" 2> "$test_dir/$mode.log" &
  pid=$!
  printf '%s\n' '{"id":"inventory","type":"get_commands"}' >&3
  received=false
  while IFS= read -r -t 30 reply <&4; do
    printf '%s\n' "$reply" > "$test_dir/reply.json"
    jq -e '.id == "inventory" and .type == "response"' "$test_dir/reply.json" >/dev/null || continue
    received=true
    break
  done
  [[ "$received" == true ]] || fail "$mode inventory timed out"
  jq -e --arg mode "$mode" --arg root "$project" '
    .success == true and (.data.commands |
      (any(.[]; .name == "skill:how") == ($mode != "disabled")) and
      (any(.[]; .name == "skill:project-fixture" and (.path // .sourceInfo.path) == $root + "/.claude/skills/project-fixture/SKILL.md") == ($mode == "trusted" or $mode == "child")) and
      (any(.[]; .name == "skill:local-fixture") == ($mode == "trusted" or $mode == "child")) and
      all(.[]; .name != "skill:outside-fixture"))
  ' "$test_dir/reply.json" >/dev/null || {
    jq '.data.commands | map(select(.source == "skill") | {name, sourceInfo})' "$test_dir/reply.json" >&2
    fail "$mode skill discovery"
  }
  kill -TERM -- "-$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  exec 3>&- 4>&-
done
printf '%s\n' 'PASS: global/project Claude skills, subdirectory discovery, trust, repo boundary and child extension loadout.'

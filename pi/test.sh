#!/usr/bin/env bash
# Bash 3.2 RPC test harness; jq parses and validates JSON.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
live=false
case "${1:-}" in
  '') ;;
  --live) live=true; export HOME="$original_home" ;;
  *) fail 'Usage: pi/test.sh [--live]' ;;
esac
if [[ "$live" == false ]]; then
  mkdir -p "$HOME/.claude/commands/nested" "$HOME/.claude/skills/example/references"
  printf '%s\n' '---' 'description: Review fixture' '---' 'Review $1 with $ARGUMENTS.' > "$HOME/.claude/commands/nested/review.md"
  printf '%s\n' '---' 'name: example' 'description: Example fixture' '---' 'Read references/guide.md.' > "$HOME/.claude/skills/example/SKILL.md"
  printf '%s' 'Reference fixture' > "$HOME/.claude/skills/example/references/guide.md"
fi
mkfifo "$test_dir/input" "$test_dir/output"
exec 3<> "$test_dir/input"
exec 4<> "$test_dir/output"
"$repo/pi.sh" --mode rpc --offline --no-session --no-approve < "$test_dir/input" > "$test_dir/output" 2> "$test_dir/pi.log" &
rpc() {
  printf '%s\n' "$2" >&3
  while IFS= read -r -t 30 reply <&4; do
    printf '%s\n' "$reply" > "$test_dir/reply.json"
    jq -e --arg id "$1" '.type == "response" and .id == $id' "$test_dir/reply.json" >/dev/null || continue
    jq -e '.success' "$test_dir/reply.json" >/dev/null || fail "RPC $1: $reply"
    jq -c '.data' "$test_dir/reply.json" >> "$test_dir/responses.jsonl"
    return
  done
  fail "RPC $1 timed out"
}
rpc 1 '{"id":"1","type":"get_commands"}'
if [[ "$live" == false ]]; then
  rpc 2 '{"id":"2","type":"steer","message":"/review \"two words\" extra"}'
  rpc 3 '{"id":"3","type":"clear_queue"}'
  rpc 4 '{"id":"4","type":"steer","message":"/skill:example some context"}'
  rpc 5 '{"id":"5","type":"clear_queue"}'
  [[ "$(< "$HOME/.claude/skills/example/references/guide.md")" == 'Reference fixture' ]] || fail 'Reference changed'
fi
jq -es --argjson live "$live" --arg home "$HOME" '
  def check(condition; message): if condition then . else error(message) end;
  . as $responses |
  .[0].commands | map(. + {path: (.path // .sourceInfo.path)}) |
  reduce ["run", "subagents-doctor", "subagents-fleet", "search", "diff", "view"][] as $name
    (.; check(any(.[]; .name == $name and .source == "extension"); "Missing extension command /" + $name)) |
  reduce ["websearch", "curator", "google-account", "review-loop"][] as $name
    (.; check(all(.[]; .name != $name); "Unexpected command /" + $name)) |
  if $live then
    map(select((.path // "") | startswith($home + "/.claude/"))) |
    check((map(select(.source == "prompt")) | length == 3); "Expected 3 Claude prompts") |
    check((map(select(.source == "skill")) | length == 11); "Expected 11 Claude skills")
  else
    check(any(.[]; .name == "review" and .source == "prompt"); "Missing nested /review prompt") |
    check(any(.[]; .name == "skill:example" and .path == $home + "/.claude/skills/example/SKILL.md"); "Skill source path mismatch") |
    check($responses[2].steering == ["Review two words with two words extra."]; "Quoted prompt arguments expanded incorrectly") |
    reduce ["Read references/guide.md", "some context", "skills/example"][] as $text
      (.; check(($responses[4].steering[0] | contains($text)); "Expanded skill missing: " + $text))
  end | true
' "$test_dir/responses.jsonl" >/dev/null || fail 'RPC inventory or expansion assertions'
if grep -Ei 'Failed to load extension|extension error' "$test_dir/pi.log"; then fail 'Extension loading'; fi
printf '%s\n' 'PASS: RPC inventory, recursive commands, arguments, skills and reference paths.'

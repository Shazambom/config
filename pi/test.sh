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
  printf '%s\n' '---' 'description: Review fixture' '---' 'Review $1 with $ARGUMENTS.' > "$HOME/.claude/commands/nested/fixture-review.md"
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
  rpc 2 '{"id":"2","type":"steer","message":"/fixture-review \"two words\" extra"}'
  rpc 3 '{"id":"3","type":"clear_queue"}'
  rpc 4 '{"id":"4","type":"steer","message":"/skill:example some context"}'
  rpc 5 '{"id":"5","type":"clear_queue"}'
  rpc 6 '{"id":"6","type":"steer","message":"/skill:design Use the existing fixture plan"}'
  rpc 7 '{"id":"7","type":"clear_queue"}'
  rpc 8 '{"id":"8","type":"steer","message":"/design python fixture-plan"}'
  rpc 9 '{"id":"9","type":"clear_queue"}'
  rpc 10 '{"id":"10","type":"steer","message":"/design golang fixture-plan"}'
  rpc 11 '{"id":"11","type":"clear_queue"}'
  rpc 12 '{"id":"12","type":"steer","message":"/design rust fixture-plan"}'
  rpc 13 '{"id":"13","type":"clear_queue"}'
  rpc 14 '{"id":"14","type":"steer","message":"/code-review high --fix fixture-path"}'
  rpc 15 '{"id":"15","type":"clear_queue"}'
  rpc 16 '{"id":"16","type":"steer","message":"/skill:code-review medium fixture-path"}'
  rpc 17 '{"id":"17","type":"clear_queue"}'
  diff -qr "$repo/claude/skills/code-review" "$HOME/.claude/skills/code-review"
  for file in golang.md python.md rust.md design.py.txt support.py.txt design.rs.txt support.rs.txt; do
    cmp "$repo/claude/skills/design/references/$file" "$HOME/.claude/skills/design/references/$file"
  done
  for file in design.go.txt support.go.txt; do
    example="$HOME/.claude/skills/design/references/$file"
    cmp "$repo/claude/skills/design/references/$file" "$example"
    awk 'length($0) > 100 { exit 1 }' "$example" || fail 'Design example exceeds 100 columns'
    if grep -Eq '^(```|#|\||\+|-)' "$example"; then fail 'Design example contains Markdown or inline diff markers'; fi
  done
  [[ "$(< "$HOME/.claude/skills/example/references/guide.md")" == 'Reference fixture' ]] || fail 'Reference changed'
fi
jq -es --argjson live "$live" --arg home "$HOME" '
  def check(condition; message): if condition then . else error(message) end;
  . as $responses |
  .[0].commands | map(. + {path: (.path // .sourceInfo.path)}) |
  reduce ["subagent", "browser", "snippets", "om", "om:status", "om:compact", "om:consolidate", "diff", "view"][] as $name
    (.; check(any(.[]; .name == $name and .source == "extension"); "Missing extension command /" + $name)) |
  reduce ["run", "subagents-doctor", "subagents-fleet", "search", "websearch", "curator", "google-account", "review-loop", "skill:pi-subagents", "skill:council-mode"][] as $name
    (.; check(all(.[]; .name != $name); "Unexpected command /" + $name)) |
  if $live then
    map(select((.path // "") | startswith($home + "/.claude/"))) |
    check((map(select(.source == "prompt")) | length >= 22); "Expected bundled Claude prompts") |
    check((map(select(.source == "skill")) | length >= 12); "Expected bundled Claude skills")
  else
    check(any(.[]; .name == "fixture-review" and .source == "prompt"); "Missing nested /fixture-review prompt") |
    check(any(.[]; .name == "skill:example" and .path == $home + "/.claude/skills/example/SKILL.md"); "Skill source path mismatch") |
    check(any(.[]; .name == "skill:design" and .path == $home + "/.claude/skills/design/SKILL.md"); "Missing bundled design skill") |
    check(any(.[]; .name == "design" and .source == "prompt"); "Missing /design alias") |
    check(any(.[]; .name == "code-review" and .source == "prompt"); "Missing /code-review alias") |
    check(any(.[]; .name == "skill:code-review" and .path == $home + "/.claude/skills/code-review/SKILL.md"); "Missing bundled code-review skill") |
    check(($responses[14].steering | length) == 1 and ($responses[14].steering[0] | contains("high --fix fixture-path")); "Code review alias lost arguments") |
    check(($responses[16].steering | length) == 1 and ($responses[16].steering[0] | contains("medium fixture-path")) and ($responses[16].steering[0] | contains("skills/code-review")); "Code review skill expansion failed") |
    check(($responses[8].steering | length) == 1 and ($responses[8].steering[0] | contains("python fixture-plan")); "Python design arguments lost") |
    check(($responses[10].steering | length) == 1 and ($responses[10].steering[0] | contains("golang fixture-plan")); "Go design arguments lost") |
    check(($responses[12].steering | length) == 1 and ($responses[12].steering[0] | contains("rust fixture-plan")); "Rust design arguments lost") |
    check(($responses[6].steering | length) == 1; "Design skill did not queue exactly once") |
    reduce ["# Design", "references/golang.md", "references/python.md", "references/rust.md", "leading selector", "design.py", "design.rs", "Flow first", "A good flow looks like this", "DERIVATION: IsProviderBoundReschedule", "Every introduced field", "derivation coverage", "Apply the comment rules", "No comments inside structs", "One call per block", "orderID, err := orderStore.Insert(", "TOOLING SUPPORT ONLY", "Write valid declarations",  "design.go", "Use `/view` for every review round", "Boundaries and KISS", "simplest design that meets the requirements", "git check-ignore -q", "git ls-files", "Prefer an existing Git-ignored", "Use the existing fixture plan"][] as $text
      (.; check(($responses[6].steering[0] | contains($text)); "Expanded design skill missing: " + $text)) |
    check($responses[2].steering == ["Review two words with two words extra."]; "Quoted prompt arguments expanded incorrectly") |
    reduce ["Read references/guide.md", "some context", "skills/example"][] as $text
      (.; check(($responses[4].steering[0] | contains($text)); "Expanded skill missing: " + $text))
  end | true
' "$test_dir/responses.jsonl" >/dev/null || fail 'RPC inventory or expansion assertions'
if grep -Ei 'Failed to load extension|extension error' "$test_dir/pi.log"; then fail 'Extension loading'; fi
printf '%s\n' 'PASS: RPC inventory, recursive commands, arguments, skills and reference paths.'

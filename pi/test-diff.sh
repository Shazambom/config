#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
[[ $# == 0 ]] || fail 'Usage: pi/test-diff.sh'
PI_CODING_AGENT_DIR="$CONFIG_PI_HOME/agent" node "$repo/pi/tests/diff-colors-fixture.mjs"
node "$repo/pi/tests/diff-ui-fixture.mjs"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.invalid

diff_json() { node "$repo/pi/tests/diff-fixture.mjs" "$PWD" "${1:-}"; }
has_text() { jq -e --arg text "$1" '.text | contains($text)' "$test_dir/diff.json" >/dev/null || fail "Missing $1"; }
has_file() { jq -e --arg path "$1" 'any(.lines[]; .filePath == $path)' "$test_dir/diff.json" >/dev/null || fail "Missing parsed file $1"; }

git init -q
git symbolic-ref HEAD refs/heads/main
printf 'base\n' > tracked
printf 'delete me\n' > deleted
printf 'ignored\n' > .gitignore
git add .
git commit -qm base
git checkout -qb feature
printf 'branch change\n' > committed
git add committed
git commit -qm feature
git checkout -q main
printf 'main only\n' > main-only
git add main-only
git commit -qm main
git checkout -q feature
printf 'staged\n' >> tracked
git add tracked
printf 'unstaged\n' >> tracked
rm deleted
printf 'new\n' > 'new file.txt'
printf 'ignored secret\n' > ignored
printf 'no newline' > --odd
printf 'unicode\n' > 'café.txt'
: > empty
printf '\0binary\n' > binary
printf 'outside secret\n' > "$test_dir/outside"
ln -s "$test_dir/outside" link
mkdir sub
cp .git/index "$test_dir/index.before"
git status --porcelain=v1 -z > "$test_dir/status.before"
diff_json > "$test_dir/diff.json"
has_text '+branch change'
has_text '+staged'
has_text '+unstaged'
has_text '-delete me'
has_text '+new'
has_file 'new file.txt'
has_file --odd
has_file 'café.txt'
has_file empty
has_file binary
has_file link
jq -e '.text | contains("main-only") or contains("ignored secret") or contains("outside secret") | not' "$test_dir/diff.json" >/dev/null
cmp .git/index "$test_dir/index.before"
git status --porcelain=v1 -z > "$test_dir/status.after"
cmp "$test_dir/status.before" "$test_dir/status.after"
(cd sub; diff_json) > "$test_dir/nested.json"
cmp "$test_dir/diff.json" "$test_dir/nested.json"
printf 'newline path\n' > $'line\nbreak.txt'
if diff_json > "$test_dir/control-path.log" 2>&1; then fail 'Accepted unsafe annotation path'; fi
grep -q 'cannot safely annotate' "$test_dir/control-path.log"
rm $'line\nbreak.txt'
diff_json --turn-based > "$test_dir/turn.json"
jq -e '.source.turnBased and .source.everything' "$test_dir/turn.json" >/dev/null
diff_json HEAD > "$test_dir/head.json"
for alias in h ' h '; do
  diff_json "$alias" > "$test_dir/alias.json"
  cmp "$test_dir/head.json" "$test_dir/alias.json" || fail '/diff h differs from /diff HEAD'
done
for args in '--cached' 'HEAD' 'main...HEAD' '--' 'HEAD -- @tracked'; do
  diff_json "$args" > "$test_dir/explicit.json"
  jq -e '.source.everything != true' "$test_dir/explicit.json" >/dev/null
  case "$args" in
    'HEAD -- @tracked') git diff --no-color --unified=3 HEAD -- tracked > "$test_dir/expected" ;;
    *) git diff --no-color --unified=3 $args > "$test_dir/expected" ;;
  esac
  jq -jr '.text' "$test_dir/explicit.json" > "$test_dir/actual"
  cmp "$test_dir/expected" "$test_dir/actual"
done

git update-ref refs/remotes/origin/main main
git branch -D main >/dev/null
diff_json > "$test_dir/diff.json"
jq -e '.source.label | contains("refs/remotes/origin/main")' "$test_dir/diff.json" >/dev/null
git update-ref -d refs/remotes/origin/main
diff_json > "$test_dir/diff.json"
jq -e '.source.label | contains("no main or origin/main")' "$test_dir/diff.json" >/dev/null
has_text '+unstaged'

mkdir "$test_dir/unborn"
cd "$test_dir/unborn"
git init -q
printf 'staged new\n' > staged
git add staged
printf 'untracked new\n' > untracked
diff_json > "$test_dir/diff.json"
has_text '+staged new'
has_text '+untracked new'

mkdir "$test_dir/submission-agent"
node "$repo/pi/tests/diff-submit-fixture.mjs" "$PWD" "$test_dir/submission-agent"

mkdir "$test_dir/not-git"
cd "$test_dir/not-git"
if diff_json > "$test_dir/nonrepo.log" 2>&1; then fail 'Accepted non-repository'; fi
printf '%s\n' 'PASS: complete diff, merge base, untracked paths, parser, explicit args, fallbacks, unchanged index.'

#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
helper=${1:-$repo/claude/skills/complaint/scripts/complaints.sh}
work=$(mktemp -d "${TMPDIR:-/tmp}/complaints-test.XXXXXX")
work=$(cd "$work" && pwd -P)
trap 'rm -rf "$work"' EXIT
export HOME="$work/home"
mkdir "$HOME"
queue="$HOME/.pi/complaints"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
reject() { if "$@" >"$work/out" 2>"$work/err"; then fail "accepted: $*"; fi; }
input='{"title":"Lost request","body":"# Request\nKeep it intact.","approval_quote":"Yes, save exactly that.","origin":{"project":"example","session":"session-1"}}'
# Full runtime path, including a timestamp/mtime disagreement.
a=$(printf '%s' "$input" | bash "$helper" save)
[ -f "$a" ] || fail 'save did not publish report'
jq '.created_at="2020-01-01T00:00:00Z"' "$a" > "$work/old"
cp "$work/old" "$a"
b=$(printf '%s' "$input" | bash "$helper" save)
jq -e '.title == "Lost request" and .body == "# Request\nKeep it intact."' "$b" >/dev/null
cp "$b" "$work/before-resolution"
touch -t 203001010000 "$a"
selected=$(cd "$work" && bash "$helper" latest)
[ "$selected" = "$b" ] || fail 'latest must use created_at rather than mtime'
printf '%s' '{"status":"addressed","summary":"Fixed","verification":"Regression passed"}' | bash "$helper" resolve "$b" > "$work/resolved"
[ "$(cd / && bash "$helper" latest)" = "$b" ] || fail 'resolved latest must remain latest'
printf 'PASS: save -> latest -> resolve -> latest across cwd, ordered by created_at\n'
# Blank outcomes must not resolve a valid, still-unresolved report.
for invalid in \
    '{"status":"addressed","summary":"","verification":"not run"}' \
    '{"status":"addressed","summary":" ","verification":"not run"}' \
    '{"status":"addressed","summary":"Fixed","verification":""}' \
    '{"status":"addressed","summary":"Fixed","verification":"\t\n"}'; do
    reject bash "$helper" resolve "$a" <<< "$invalid"
    grep -q 'invalid resolution input' "$work/err" || fail 'missing invalid outcome diagnostic'
    [ ! -e "${a%.complaint.json}.resolution.json" ] || fail 'blank outcome wrote resolution'
done
# Originals and immutable outcomes, including conflicting second resolution.
resolution=$(<"$work/resolved")
cmp "$b" "$work/before-resolution"
jq -e '.status == "addressed" and .summary == "Fixed" and .verification == "Regression passed" and (.resolved_at | endswith("Z"))' "$resolution" >/dev/null
jq -e '.schema_version == 1 and .status == "approved" and .approval_quote == "Yes, save exactly that." and .origin.session == "session-1"' "$b" >/dev/null
cp "$b" "$work/original"
cp "$resolution" "$work/outcome"
reject bash "$helper" resolve "$b" <<< '{"status":"deferred","summary":"Later","verification":"not run"}'
grep -q 'resolution already exists:' "$work/err" || fail 'missing existing outcome diagnostic'
cmp "$resolution" "$work/outcome"
cmp "$b" "$work/original"
mode() {
    local value
    if value=$(stat -f '%Lp' "$1" 2>/dev/null); then
        printf '%s\n' "$value"
    else
        stat -c '%a' "$1"
    fi
}
[ "$(mode "$queue")" = 700 ] || fail 'queue permissions'
[ "$(mode "$b")" = 600 ] || fail 'report permissions'
[ "$(mode "$resolution")" = 600 ] || fail 'resolution permissions'
[ -z "$(find "$queue" -name '.pending.*' -print)" ] || fail 'temporary file leak'
# A tie is an error even when one report already has a resolution.
cp "$b" "$queue/tie.complaint.json"
reject bash "$helper" latest
grep -q 'ambiguous' "$work/err" || fail 'missing ambiguity diagnostic'
grep -Fq "$b" "$work/err" || fail 'missing first tied path'
grep -Fq "$queue/tie.complaint.json" "$work/err" || fail 'missing second tied path'
rm "$queue/tie.complaint.json"
# Any malformed queue record fails closed, even when older than the winner.
printf '{}' > "$queue/bad.complaint.json"
reject bash "$helper" latest
rm "$queue/bad.complaint.json"
ln -s "$a" "$queue/link.complaint.json"
reject bash "$helper" latest
grep -q 'not an owned regular report:' "$work/err" || fail 'missing symlink report diagnostic'
reject bash "$helper" resolve "$queue/link.complaint.json" <<< '{"status":"addressed","summary":"Fixed","verification":"not run"}'
grep -q 'not an owned regular report:' "$work/err" || fail 'missing symlink resolution diagnostic'
rm "$queue/link.complaint.json"
cp "$b" "$work/outside.complaint.json"
for path in "$work/outside.complaint.json" "$queue/../../outside.complaint.json" "$queue/../complaints/${b##*/}"; do
    reject bash "$helper" resolve "$path" <<< '{"status":"addressed","summary":"Fixed","verification":"not run"}'
    grep -q 'report must be a direct queue-owned absolute path' "$work/err" || fail 'missing queue path diagnostic'
done
# Existing outcome symlinks, directories, and regular files are never replaced.
ln -s "$work/missing" "${a%.complaint.json}.resolution.json"
reject bash "$helper" resolve "$a" <<< '{"status":"addressed","summary":"Fixed","verification":"not run"}'
grep -q 'resolution already exists:' "$work/err" || fail 'missing symlink conflict diagnostic'
[ ! -e "$work/missing" ] || fail 'followed outcome symlink'
rm "${a%.complaint.json}.resolution.json"
mkdir "${a%.complaint.json}.resolution.json"
reject bash "$helper" resolve "$a" <<< '{"status":"addressed","summary":"Fixed","verification":"not run"}'
grep -q 'resolution already exists:' "$work/err" || fail 'missing directory conflict diagnostic'
rmdir "${a%.complaint.json}.resolution.json"
for status in deferred not_reproduced; do
    printf '{"status":"%s","summary":"Needs further investigation","verification":"not run"}' "$status" | bash "$helper" resolve "$a" >/dev/null
    jq -e --arg status "$status" '.status == $status' "${a%.complaint.json}.resolution.json" >/dev/null
    rm "${a%.complaint.json}.resolution.json"
done
# Resolution requires approved status, and successful writes restore private mode.
jq '.status="draft"' "$a" > "$work/draft"
cp "$work/draft" "$a"
reject bash "$helper" resolve "$a" <<< '{"status":"addressed","summary":"Fixed","verification":"not run"}'
grep -q 'malformed report:' "$work/err" || fail 'missing approved status diagnostic'
cp "$work/old" "$a"
chmod 755 "$queue"
printf '%s' '{"status":"addressed","summary":"Fixed","verification":"not run"}' | bash "$helper" resolve "$a" >/dev/null
[ "$(mode "$queue")" = 700 ] || fail 'resolution must keep queue private'
# A destination created just before publication must not be treated as a folder.
# Wrap the real OS utility, not its filesystem behavior.
mkdir "$work/bin"
for utility in ln link; do
    real_utility=$(command -v "$utility")
    printf '#!/usr/bin/env bash\nmkdir -- "$2"\nexec %q "$@"\n' "$real_utility" > "$work/bin/$utility"
    chmod 700 "$work/bin/$utility"
done
reject env PATH="$work/bin:$PATH" /bin/bash "$helper" save <<< "$input"
[ -z "$(find "$queue" -mindepth 2 -type f -print)" ] || fail 'publication wrote inside existing directory'
[ -z "$(find "$queue" -name '.pending.*' -print)" ] || fail 'failed publication left temporary content'
# Invalid schemas and JSON streams cannot create even the queue directory.
export HOME="$work/empty-home"
mkdir "$HOME"
reject bash "$helper" latest
[ ! -e "$HOME/.pi" ] || fail 'empty latest wrote state'
for invalid in '' '{}' 'null' '[]' '{' "$input {}" \
    '{"title":"Draft","body":"Draft","origin":{"project":"x"}}' \
    '{"title":" ","body":"body","approval_quote":"yes","origin":{"project":"x"}}' \
    '{"title":"title","body":" ","approval_quote":"yes","origin":{"project":"x"}}' \
    '{"title":"title","body":"body","approval_quote":" ","origin":{"project":"x"}}' \
    '{"title":"title","body":"body","approval_quote":"yes","origin":{"project":1}}' \
    '{"title":"title","body":"body","approval_quote":"yes","origin":{"project":""}}' \
    '{"title":"title","body":"body","approval_quote":"yes","origin":{"project":" \t"}}' \
    '{"title":"title","body":"body","approval_quote":"yes","origin":{"project":"x","session":null}}' \
    "$(printf '%s' "$input" | jq '.status="approved"')"; do
    reject bash "$helper" save <<< "$invalid"
    [ ! -e "$HOME/.pi" ] || fail 'invalid input wrote state'
done
for invalid in '' '{}' '{"status":"approved","summary":"x","verification":"x"}' '{"status":"addressed","summary":1,"verification":"x"}'; do
    reject bash "$helper" resolve "$b" <<< "$invalid"
    [ ! -e "$HOME/.pi" ] || fail 'invalid resolution wrote state'
done
mkdir "$work/external"
ln -s "$work/external" "$HOME/.pi"
reject bash "$helper" save <<< "$input"
grep -q 'symlink directory:' "$work/err" || fail 'missing .pi symlink save diagnostic'
reject bash "$helper" latest
grep -q 'symlink directory:' "$work/err" || fail 'missing .pi symlink latest diagnostic'
[ -z "$(ls -A "$work/external")" ] || fail 'followed .pi symlink'
rm "$HOME/.pi"
mkdir "$HOME/.pi"
ln -s "$work/external" "$HOME/.pi/complaints"
reject bash "$helper" save <<< "$input"
grep -q 'symlink directory:' "$work/err" || fail 'missing queue symlink save diagnostic'
reject bash "$helper" latest
grep -q 'symlink directory:' "$work/err" || fail 'missing queue symlink latest diagnostic'
[ -z "$(ls -A "$work/external")" ] || fail 'followed queue symlink'
reject env HOME=/ bash "$helper" latest
reject env HOME=relative bash "$helper" latest
reject env HOME= bash "$helper" latest
printf 'PASS: validation, no-write failures, permissions, immutable outcomes, ties, symlinks, traversal\n'

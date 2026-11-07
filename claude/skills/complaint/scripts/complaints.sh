#!/usr/bin/env bash
# Format validation only. The calling workflow must obtain human approval.
set -euo pipefail
umask 077
fail() { printf 'complaints: %s\n' "$*" >&2; exit 1; }
[ "$#" -ge 1 ] || fail 'usage: complaints.sh save | latest | resolve <path>'
command=$1
shift
case "$command:$#" in save:0|latest:0|resolve:1) ;; *) fail 'usage: complaints.sh save | latest | resolve <path>' ;; esac
command -v jq >/dev/null || fail 'jq is required'
command -v link >/dev/null || fail 'POSIX link is required'
case "${HOME:-}" in /*) ;; *) fail 'HOME must be an absolute directory' ;; esac
home=$(cd "$HOME" && pwd -P) || fail 'HOME is unavailable'
[ "$home" != / ] || fail 'HOME must not be the filesystem root'
queue="$home/.pi/complaints"
check_dirs() {
    local dir
    for dir in "$home/.pi" "$queue"; do
        [ ! -L "$dir" ] || fail "symlink directory: $dir"
        if [ -e "$dir" ]; then
            [ -d "$dir" ] && [ -O "$dir" ] || fail "not an owned directory: $dir"
        fi
    done
}
check_dirs
# Exact keys prevent caller-supplied metadata or accidental partial reports.
common='def text: type == "string" and test("\\S");
def report: type == "object" and (.title | text) and (.body | text)
 and (.approval_quote | text) and (.origin | type == "object"
 and ((keys - ["project","session"]) | length == 0)
 and (.project | text)
 and (if has("session") then (.session | type == "string") else true end));
def timestamp: type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
 and (try ((fromdateiso8601 | todateiso8601) == .) catch false);
def stored: report and (keys == ["approval_quote","body","created_at","origin","schema_version","status","title"])
 and .schema_version == 1 and .status == "approved" and (.created_at | timestamp);'
# Read and validate before creating any directories or temporary files.
if [ "$command" = save ]; then
    input=$(jq -ces "$common if length == 1 and (.[0] | report and (keys == [\"approval_quote\",\"body\",\"origin\",\"title\"])) then .[0] else error(\"invalid approved report\") end") || fail 'invalid approved report input'
elif [ "$command" = resolve ]; then
    input=$(jq -ces "$common if length == 1 and (.[0] | type == \"object\" and (keys == [\"status\",\"summary\",\"verification\"]) and (.status == \"addressed\" or .status == \"deferred\" or .status == \"not_reproduced\") and (.summary | text) and (.verification | text)) then .[0] else error(\"invalid resolution\") end") || fail 'invalid resolution input'
fi
validate_record() {
    [ ! -L "$1" ] && [ -f "$1" ] && [ -O "$1" ] || fail "not an owned regular report: $1"
    jq -es "$common length == 1 and (.[0] | stored)" "$1" >/dev/null || fail "malformed report: $1"
}
if [ "$command" = latest ]; then
    newest=''
    selected=()
    shopt -s nullglob dotglob
    for path in "$queue"/*.complaint.json; do
        validate_record "$path"
        created=$(jq -r .created_at "$path")
        if [[ "$created" > "$newest" ]]; then
            newest=$created
            selected=("$path")
        elif [ "$created" = "$newest" ]; then
            selected+=("$path")
        fi
    done
    [ "${#selected[@]}" -gt 0 ] || fail 'no approved complaints'
    if [ "${#selected[@]}" -gt 1 ]; then
        printf 'complaints: ambiguous newest created_at %s:\n' "$newest" >&2
        printf '%s\n' "${selected[@]}" >&2
        exit 1
    fi
    printf '%s\n' "${selected[0]}"
    exit
fi
if [ "$command" = resolve ]; then
    path=$1
    [ "${path%/*}" = "$queue" ] || fail 'report must be a direct queue-owned absolute path'
    case "${path##*/}" in *.complaint.json) ;; *) fail 'not a complaint path' ;; esac
    validate_record "$path"
    target="${path%.complaint.json}.resolution.json"
    [ ! -e "$target" ] && [ ! -L "$target" ] || fail "resolution already exists: $target"
else
    mkdir -p "$queue"
fi
# Hard-link publication is atomic and refuses existing targets; unlike mv it
# cannot replace a prior report or outcome. Temporary files stay in the queue.
temp=''
trap '[ -z "$temp" ] || rm -f "$temp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
check_dirs
chmod 700 "$queue"
temp=$(mktemp "$queue/.pending.XXXXXXXX")
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ "$command" = save ]; then
    target="$queue/${now//:/-}-${temp##*.}.complaint.json"
    printf '%s' "$input" | jq --arg now "$now" '. + {schema_version:1,created_at:$now,status:"approved"}' > "$temp"
else
    printf '%s' "$input" | jq --arg now "$now" '. + {resolved_at:$now}' > "$temp"
fi
chmod 600 "$temp"
# link(1) addresses the exact destination; ln would treat a directory as a folder.
link "$temp" "$target" || fail "cannot publish without overwriting: $target"
printf '%s\n' "$target"

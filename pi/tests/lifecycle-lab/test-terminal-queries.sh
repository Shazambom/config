#!/usr/bin/env bash
# Exercise the actual private PTY helper against a deterministic terminal-query peer.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
proof="$(mktemp -d "${TMPDIR:-/tmp}/lifecycle-terminal-queries.XXXXXX")"
printf 'Evidence: %s\n' "$proof"
mkdir -p "$proof/clients/protocol" "$proof/home"
shasum -a 256 "$here/terminal_client.py" "$here/terminal-query-peer.py" "${BASH_SOURCE[0]}" > "$proof/hashes.txt"
# Direct feeds make every three-chunk partition deterministic, independent of
# kernel PTY coalescing. The peer below separately exercises the actual I/O path.
PYTHONDONTWRITEBYTECODE=1 python3 - "$here/terminal_client.py" > "$proof/parser.log" <<'PY'
import importlib.util
import sys
spec = importlib.util.spec_from_file_location('lab_terminal', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cases = 0
for end in (b'\x07', b'\x1b\\'):
    for query, expected in (
        (b'\x1b]10;?' + end, b'\x1b]10;rgb:e5e5/e5e5/e5e5' + end),
        (b'\x1b]11;?' + end, b'\x1b]11;rgb:0000/0000/0000' + end),
        (b'\x1b]4;1;?;255;?' + end,
         b'\x1b]4;1;rgb:cdcd/0000/0000' + end + b'\x1b]4;255;rgb:eeee/eeee/eeee' + end),
    ):
        for first in range(len(query) + 1):
            for second in range(first, len(query) + 1):
                parser = module.TerminalQueries()
                replies = []
                for part in (query[:first], query[first:second], query[second:]):
                    replies.extend(parser.feed(part))
                assert all(original == query for original, _ in replies)
                assert b''.join(reply for _, reply in replies) == expected
                cases += 1
parser = module.TerminalQueries()
assert parser.feed(b'\x1b]52;' + b'x' * 10000) == []
assert len(parser.payload) <= parser.LIMIT
assert parser.feed(b'\x1b]10;?\x07') == []
assert parser.feed(b'\x1b]11;?\x07') == [(b'\x1b]11;?\x07', b'\x1b]11;rgb:0000/0000/0000\x07')]
print(f'PASS {cases} deterministic three-chunk partitions and bounded discard/recovery')
PY
# Python is required here for raw PTY input/output and byte-exact split testing.
# This peer is passed as the helper's owned child, not a real/default tmux server.
cp "$here/terminal-query-peer.py" "$proof/peer.py"
chmod +x "$proof/peer.py"
env -i HOME="$proof/home" PATH="$PATH" TERM=xterm-256color \
  "$(command -v python3)" "$here/terminal_client.py" "$proof" protocol "$proof/peer.py" > "$proof/helper.log" 2>&1
jq -e '.code == 0' "$proof/clients/protocol/exit.json" >/dev/null || {
  echo 'FAIL private terminal did not satisfy supported query protocol' >&2
  [[ ! -f "$proof/peer-result.json" ]] || jq . "$proof/peer-result.json"
  exit 1
}
jq -e '.success and .cases > 30' "$proof/peer-result.json" >/dev/null
cmp "$proof/sent.ansi" "$proof/clients/protocol/terminal.ansi"
cmp "$proof/received.ansi" "$proof/clients/protocol/terminal-input.ansi"
jq -es 'length>30 and all(.[];.event=="terminal-response" and .bytesWritten>0)' "$proof/clients/protocol/terminal-responses.jsonl" >/dev/null
printf 'PASS supported query replies, split reads, ignored side effects and exact traffic capture\n' | tee "$proof/assertions.txt"

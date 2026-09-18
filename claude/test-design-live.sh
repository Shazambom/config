#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "${1:-}" == --run && $# == 1 ]] || { echo 'Usage: bash claude/test-design-live.sh --run (uses configured model quota)' >&2; exit 2; }
umask 077
proof="$(mktemp -d /tmp/design-command-proof.XXXXXX)"
export PATH="$PATH:$HOME/.cargo/bin"
printf 'Proof directory: %s\n' "$proof"
for spec in 'python py' 'golang go' 'rust rs'; do
  read -r language extension <<< "$spec"
  project="$proof/$language"
  mkdir -p "$project"
  git -C "$project" init -q
  printf '/.design/\n' > "$project/.gitignore"
  printf 'package orders\n\ntype Receipt struct { OrderID string }\n\nfunc NewReceipt(id string) Receipt { return Receipt{OrderID: id} }\n' > "$project/orders.go"
  printf '%s\n' '# Existing plan' 'Add DisplayLabel to Receipt in orders.go. NewReceipt must derive it as "Order " plus id when id is nonempty, or "Unknown order" when id is empty. Keep OrderID and the function signature unchanged. Propose no other behavior. This is a design review, not authorization to implement. The implementation remains Go regardless of document language.' > "$project/PLAN.md"
  cp "$project/orders.go" "$proof/$language-source-before"
  (
    cd "$project"
    CONFIG_PI_NO_PROMPT=1 "$repo/pi.sh" --no-extensions --no-session --mode json -p "/design $language PLAN.md" > "$proof/$language-session.jsonl" 2> "$proof/$language-stderr.log"
  )
  cmp "$proof/$language-source-before" "$project/orders.go"
  files="$(find "$project/.design" -type f -name "design.$extension")"
  [[ "$(printf '%s\n' "$files" | wc -l | tr -d ' ')" == 1 && -f "$files" ]]
  directory="$(dirname "$files")"
  (
    cd "$project"
    git check-ignore -q -- "${files#"$project/"}"
    [[ -z "$(git ls-files -- "${files#"$project/"}")" ]]
  )
  [[ -n "$(find "$directory/snapshots" -type f -name "design.$extension.txt" -print)" ]]
  [[ -z "$(find "$directory/snapshots" -type f ! -name '*.txt' -print)" ]]
  (
    cd "$directory"
    case "$language" in
      python) pyright --project . ;;
      golang) GOWORK=off GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off go test ./...; gopls check ./*.go ;;
      rust) RUSTUP_AUTO_INSTALL=0 CARGO_NET_OFFLINE=true cargo check --offline --lib --target-dir "$PWD/target" ;;
    esac
  ) > "$proof/$language-checks.log" 2>&1
  printf 'PASS: /design %s generated %s; compiler/checker passed, snapshots are text-only, proposal is ignored/untracked, and source stayed unchanged.\n' "$language" "$files" | tee -a "$proof/result.log"
done

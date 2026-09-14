#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v go >/dev/null 2>&1 || { echo 'Go is required for this design example check.' >&2; exit 1; }
command -v gopls >/dev/null 2>&1 || { echo 'gopls is required for this design example check.' >&2; exit 1; }
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/design-go-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/snapshots/revision-001"
printf 'module design.local/session\n\ngo 1.20\n' > "$test_dir/go.mod"
for file in design.go support.go; do
  cp "$repo/claude/skills/design/references/$file.txt" "$test_dir/$file"
done
for file in design.go support.go go.mod; do
  cp "$test_dir/$file" "$test_dir/snapshots/revision-001/$file.txt"
done
cd "$test_dir"
export GOWORK=off GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off
awk '
  NR == 1 && $0 != "/*" { exit 1 }
  NR == 2 && $0 != "FLOW: place an order" { exit 1 }
  $0 == "*/" { flow_closed = 1 }
  /^package / { exit !flow_closed }
  END { if (!flow_closed) exit 1 }
' design.go || { echo 'Design flow must come first, before the package.' >&2; exit 1; }
awk 'NR > 2 { if ($0 == "*/") exit; print }' design.go > flow.txt
grep -Fq 'orderID, err := orderStore.Insert(' flow.txt
grep -Fq 'if err != nil {' flow.txt
grep -Fq 'return receipt, nil' flow.txt
if grep -Eq '(->|<-|calls |;)' flow.txt; then
  echo 'Design flow must use spaced pseudocode, not compact arrow traces.' >&2
  exit 1
fi
for file in design.go support.go; do
  [[ "$(grep '^package ' "$file")" == 'package design' ]] || { echo "$file must use package design." >&2; exit 1; }
done
if grep -Eq '^type (CustomerID|OrderID|OrderItem|OrderStore)( |$)' design.go; then
  echo 'Unchanged example stand-ins belong in support.go.' >&2
  exit 1
fi
for section in 'ADDED CONTRACTS' 'CHANGED CONTRACTS' 'REMOVED CONTRACTS'; do
  grep -Fxq "// $section" design.go || { echo "Missing section: $section" >&2; exit 1; }
done
[[ -z "$(find snapshots -name '*.go' -print)" ]] || { echo 'Snapshots must not contain live Go files.' >&2; exit 1; }
for file in design.go support.go go.mod; do
  cmp "$file" "snapshots/revision-001/$file.txt"
done
[[ -z "$(gofmt -l design.go support.go)" ]] || { echo 'Design examples need gofmt.' >&2; exit 1; }
go test ./...
gopls check design.go support.go > diagnostics.txt 2>&1
[[ ! -s diagnostics.txt ]] || { printf '%s\n' 'gopls reported diagnostics:' >&2; head -80 diagnostics.txt >&2; exit 1; }
printf '%s\n' 'PASS: flow-first design and support compile together, are gofmt-clean, have no gopls diagnostics, and use text-only package snapshots.'

#!/usr/bin/env bash
# Synthetic source snapshots for evaluating only the CLAUDE.md compliance finder.
set -euo pipefail
umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/code-review-compliance-cases.XXXXXX")
for name in misplaced exception missing; do
  mkdir -p "$work/$name/internal/core/pricing" "$work/$name/internal/input/httpapi" "$work/$name/internal/core/data"
  git -C "$work/$name" -c init.defaultBranch=main init -q
  printf '' > "$work/$name/change.diff"
done
cat > "$work/misplaced/CLAUDE.md" <<'RULES'
# Architecture
Business calculations belong to internal/core/pricing. HTTP adapters only parse requests, call services, and format responses.
A type and all its methods belong in the same file. Do not split a service's methods into sibling files by concern.
Use the existing owning package. Creating a package or changing architectural boundaries requires user approval.
RULES
cat > "$work/misplaced/internal/core/pricing/service.go" <<'GO'
package pricing

type Service struct{}

func (s Service) Quote(amount int) int {
	return amount
}
GO
cat > "$work/misplaced/internal/core/pricing/discount.go" <<'GO'
package pricing

func (s Service) Discount(amount int) int {
	return amount - 10
}
GO
cat > "$work/misplaced/internal/input/httpapi/quote.go" <<'GO'
package httpapi

import "example/internal/core/pricing"

func Quote(service pricing.Service, amount int) int {
	total := service.Quote(amount)
	if total > 100 {
		total -= 10
	}
	return total
}
GO
cat > "$work/exception/CLAUDE.md" <<'RULES'
# Architecture
Domain types in internal/core/data must not carry serialization tags.
RULES
cat > "$work/exception/internal/core/data/CLAUDE.md" <<'RULES'
# Documented exception
Filter is a serialized filter DSL. JSON tags on Filter are allowed in this package. This exception does not apply to other domain entities.
RULES
cat > "$work/exception/internal/core/data/filter.go" <<'GO'
package data

type Filter struct {
	Query string `json:"query"`
}
GO
cp "$work/misplaced/internal/core/pricing/service.go" "$work/missing/internal/core/pricing/service.go"
cp "$work/misplaced/internal/core/pricing/discount.go" "$work/missing/internal/core/pricing/discount.go"
for spec in 'misplaced internal/core/pricing/discount.go' 'misplaced internal/input/httpapi/quote.go' 'exception internal/core/data/filter.go' 'missing internal/core/pricing/discount.go'; do
  read -r name file <<< "$spec"
  (cd "$work/$name"; git diff --no-index -- /dev/null "$file") >> "$work/$name/change.diff" || [[ $? == 1 ]]
done
jq -n --arg root "$work" '{cases:[
  {name:"misplaced",root:($root+"/misplaced"),expected:"Cite CLAUDE.md and identify both handler business logic and service methods in a sibling file. Inspect service.go as the destination. Recommend only; do not edit."},
  {name:"exception",root:($root+"/exception"),expected:"Read root and scoped CLAUDE.md. No finding against the explicitly allowed Filter JSON tags."},
  {name:"missing",root:($root+"/missing"),expected:"Report missing repo CLAUDE.md coverage. Do not invent a method co-location rule or findings from other cases."}
]}' > "$work/cases.json"
printf '%s\n' "$work"

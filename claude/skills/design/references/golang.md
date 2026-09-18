# Go documents

Read [design.go.txt](design.go.txt) and [support.go.txt](support.go.txt) in full. They model order placement, receipt construction, unchanged store inputs, and an unresolved duplicate-key policy.

Use the Go layout and validation commands in the main skill. The leading `/* ... */` holds spacious Go pseudocode. Contracts use structs and function types without bodies. Keep unchanged inspected types in `support.go`, in package `design`. Do not invent an interface to model a concrete method; label its actual receiver and use a function signature type unless an interface is itself proposed.

Run `gofmt` and the isolated offline `go test` command from the skill; use `gopls check design.go support.go` when available. Omit the support argument if there is no support file. Missing tools are unverified checks, not passes.

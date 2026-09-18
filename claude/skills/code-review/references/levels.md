# Levels and verification

| Level | Finder coverage | Candidates per angle | Verification | Gap sweep | Final cap |
| --- | --- | --- | --- | --- | --- |
| low | One diff-only pass | No per-angle budget | None | None | 4 |
| medium | Eight independent angles | Up to 6 | One fresh verifier per candidate | None | 8 |
| high | Same eight angles | Up to 6 | One fresh verifier per candidate, recall-biased | None | 10 |
| xhigh | Ten independent angles | Up to 8 | One fresh verifier per candidate | One fresh finder, up to 8 new candidates | 15 |
| max | Same as xhigh | Up to 8 | Same as xhigh | Same as xhigh | 15 |

Medium favors precision: findings should justify maintainer action. High, xhigh, and max favor recall: send concrete, partly uncertain mechanisms to verification rather than suppressing them. Do not inflate counts at any level.

The eight angles are A line-by-line, B removed behavior, C caller/callee tracing, reuse, simplification, efficiency, altitude, and conventions. Xhigh/max add D language pitfalls and E wrapper delegation.

## Low contract

Read the unified diff once, including scope components specified in the scope reference. Do not spawn children, verify candidates, read full source files, trace callers, or fetch extra source context. Reading these skill instructions and resolving Git metadata are not extra code investigation.

Exclude test and fixture hunks, including `test/`, `tests/`, `spec/`, `__tests__/`, `*_test.*`, `*.test.*`, `fixtures/`, and `testdata/`. Review runtime correctness visible in remaining hunks: wrong conditions, boundary errors, visibly nullable dereferences, removed guards, missing awaits, falsy-zero checks, wrong variables, and swallowed errors. Also allow duplication of a helper already visible in diff context and dead code left in the hunk. Do not flag performance, naming, style, missing tests, or claims requiring unseen context. Omit verdicts because no verification ran. With `--fix`, skip fixes needing broader source investigation rather than silently upgrading this level. Validation of an applied fix is still required; it is not a candidate-verifier pass.

## Candidate contract

Every candidate has `file`, `line`, `summary`, `failure_scenario`, and `category`. Use a source-relative filename and a real line in the identified revision. Record old-side location separately for deletions. A candidate must name a reachable failure mechanism or a concrete cleanup cost, not merely unease. No candidate-count minimum applies.

## Verifier contract

Read the diff and relevant source before deciding. Return the candidate plus one verdict and a verification note with exact code quotes, source paths/lines, triggering inputs or state, and wrong behavior or concrete cost.

- `CONFIRMED`: establish a reachable trigger and the wrong output, crash, rule violation, or concrete cost. Quote the responsible code. For conventions also quote the applicable rule exactly.
- `PLAUSIBLE`: the mechanism is real but its trigger, runtime environment, or impact remains uncertain. Quote supporting code, state the uncertainty, and name the evidence or test that would confirm it. Do not describe it as proven.
- `REFUTED`: quote the guard, invariant, type, or actual code that disproves it. Pure style with no observable effect or concrete cost also does not qualify.

Realistic timing, cold-cache states, optional fields, retries, partial failures, and boundary inputs are not refuted merely because they depend on runtime state. Recall-biased verification especially retains these as PLAUSIBLE unless code rules them out. One non-refuted verdict retains a candidate; do not add voting rounds or silently discard uncertain retained findings before ranking.

## Gap sweep

At xhigh/max, give a fresh read-only finder the diff, enclosing source, and retained verified list. Ask only for new mechanisms, up to eight, not re-confirmation of known findings. Focus on moved code losing guards or anchors, one-time defaults, nondeterministic hashes, changed lock scope, predicates with side effects, test setup/teardown asymmetry, and flipped config defaults. Deduplicate additions by mechanism and send each remaining new candidate to a fresh verifier. An empty sweep is valid.

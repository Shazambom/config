# Actions and output

## Safe fixes

`--fix` explicitly authorizes working-tree edits for safe, verified findings, including concrete cleanup. It does not authorize architecture changes, scope expansion, changed intent, staging, or committing. At verified levels, only fix CONFIRMED findings with a clear correction consistent with intended behavior. Skip PLAUSIBLE findings, behavior guesses, false positives, and changes needing a product decision; state why.

Before editing, confirm the local source matches the reviewed target and preserve unrelated edits. If a PR or branch snapshot does not match local source, ask before applying anything. Do not checkout or reset to make it match. Low has no candidate verification pass. With `low --fix`, only apply self-evident, hunk-local corrections that need no broader source investigation. Do not invent a verifier verdict. Skip anything needing more context and request a higher-level review if needed. Validate applied fixes with targeted checks at every level.

Inspect the edited diff and run applicable targeted tests through actual tools. Report exact checks, results, and anything not tested. Recheck affected findings against the resulting source. Track fixed, remaining, and skipped outcomes in scratch state. Issue one final report after fixes, not an initial ReportFindings call followed by an unsupported second call. Report remaining findings in the final findings array and briefly summarize fixed/skipped outcomes and checks outside that array, or in tool-supported outcome fields. Never invent report-tool fields.

## Inline comments

`--comment` explicitly authorizes posting findings to the target PR. Without it, do not post or submit a review. Resolve the repository, PR, and pinned head, and verify available write capability through a real GitHub tool or `gh api`. Do not invent an MCP tool or assume authentication. If no posting tool is available, explain that posting did not occur.

Before posting:

1. Confirm the target PR and repository. If the target is local or ambiguous, ask which PR; do not guess.
2. Recheck the current PR head against the reviewed SHA. If it changed, update and verify affected findings before posting.
3. Read existing comments and avoid duplicating your own existing report of the same mechanism on that PR.
4. Map each finding to a valid current diff line. Use `RIGHT` for additions/current code and `LEFT` for deletions/old code. Use the actual API's supported line and commit fields. Skip non-commentable findings with an explanation rather than attaching them to an unrelated line.
5. Post concise evidence and the trigger. Label PLAUSIBLE findings and what remains uncertain. Do not present unverified low findings as confirmed.

No findings means no noisy empty PR post. Report which comments actually succeeded and any failures; retrying must not duplicate successful posts.

With `--fix --comment`, distinguish local results from the remote PR head. Local edits are not on the PR until separately committed and pushed, which this skill never does. Do not post an original locally resolved issue as an unqualified current defect. Prefer skipping locally fixed findings and reporting that choice. Comment only on remaining findings verified against the current PR head, with explicit context if local and remote state differ.

## Final report

Use the actual `ReportFindings` tool once if it is available, with `{level, findings}` and its real supported schema. Do not also print the findings body. If the tool is absent, print JSON in chat with the same top-level fields. Do not claim the tool ran when it did not. Do not create a review report artifact unless the user asks; temporary reviewer inputs are allowed.

Each finding includes:

- `file`: repository-relative source path.
- `line`: real source line in the reviewed revision; identify deletion-side locations in the explanation when needed.
- `summary`: one-sentence claim.
- `short_summary`: at most 60 characters, just the claim, no rationale or consequence clause.
- `failure_scenario`: concrete inputs/state and wrong behavior, or concrete cleanup cost. Include relevant exact evidence quotes here if the tool has no verification-note field.
- `category`: a short kebab-case slug such as `correctness`, `reuse`, `simplification`, `efficiency`, `altitude`, or `conventions`.
- `verdict`: CONFIRMED or PLAUSIBLE only when a verification pass ran.
- `verification_note`: evidence quotes, trigger, and remaining uncertainty when verification ran and the output contract supports this field. Otherwise preserve that information in `failure_scenario`.

Use severity only when the real output contract supports it, with its supported values. For chat JSON, a severity field is optional; do not make unsupported numeric precision or call minor cleanup critical. Rank correctness first, then impact and evidence. Respect the level's final cap. Use `{"level":"medium","findings":[]}` when none survive at medium, with the actual selected level at other levels.

Add a short coverage/limits note separate from the findings body: target/base/head, local scope included or excluded, angles completed, independent delegation versus sequential self-review, exclusions, verification status, action outcomes, and tests actually run. Keep it brief and relevant. An unavailable tool, interrupted angle, or untested runtime path is a limitation, not completed coverage. Never claim approval, successful tests, or independent review without evidence.

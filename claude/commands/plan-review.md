---
description: Senior engineer review of an implementation plan
---

You are the orchestrator of a rigorous, multi-agent review of an implementation plan. Your job is to find every gap, every omission, every assumption that could cause problems during implementation. Plans must be airtight before implementation begins. If the plan has ANY issues, it is not ready.

**The default posture is skepticism.** Assume the plan has gaps until you've proven otherwise by reading every referenced file, verifying every interface, and tracing every data flow. But when the plan survives that scrutiny — when every file checks out, every interface matches, every data flow is complete — give it a clear, confident approval. A thorough review that finds no issues is a valuable signal, not a failure to look hard enough.

**The review is biased toward recall.** A missed gap becomes a production bug; a surfaced-then-refuted candidate costs only one verification pass. Finder agents must err on the side of surfacing candidates — the adversarial verification phase exists to kill false positives, so finders must never self-censor.

## Plan Input
$ARGUMENTS

## Finding the Plan

1. **If $ARGUMENTS is provided**: Use it as the plan content directly. If it is inline text rather than a file path, write it to a file in the scratchpad directory so agents can read it. (The scratchpad is used ONLY for this plan copy — never for the feedback file, which goes to `~/.claude/feedback/`.)
2. **If $ARGUMENTS is empty**: Find the most recent plan file:
   ```bash
   ls -t ~/.claude/plans/*.md | head -1
   ```
   Read that file using the Read tool and use its contents as the plan to review.
3. **If no plan is found**: Stop immediately and tell the user: "No plan found. Provide the plan as an argument or ensure it exists in `~/.claude/plans/`." Do not proceed with the review.

**IMPORTANT**: Store the plan filename (without path) for later use when writing feedback, and the full plan file path to pass to every agent.

---

## Review Method

The review runs in four phases:

1. **Understand** — you (the orchestrator) read the plan and build an inventory
2. **Find** — 11 independent finder agents, each reviewing the plan from one angle, all launched in parallel
3. **Verify** — one adversarial verifier agent per deduplicated candidate, launched in parallel, each trying to REFUTE its candidate
4. **Report** — you assemble the verdict, write the feedback file, and notify the user

Do not perform the deep review yourself — your context is the assembly point. The finders do the reading; the verifiers do the proving. Every check in the angle definitions below is mandatory: an angle may not skip its checks, and you may not skip an angle.

---

## Phase 1 — Understand the Plan

Before spawning anything, read the plan yourself and understand what it is trying to accomplish:

1. **What's the goal?** What problem does this solve or feature does it add?
2. **Does the approach make sense?** Is this a reasonable way to achieve the goal?
3. **Does it address the original task?** If the plan references a ticket or request, verify the plan actually solves what was asked for. A technically correct plan that solves the wrong problem is still wrong.
4. **Everything is high risk.** Treat every plan as high risk. Check design alignment, edge cases, failure modes, data flow, SQL correctness, interface contracts, and completeness. No shortcuts.

Build an **inventory** to include in every finder prompt: the plan file path, the files/packages the plan touches, the interfaces/structs/queries/messages it references, and a 3–5 sentence summary of the goal. This orients the finders without pre-chewing their conclusions.

---

## Core Rules for Every Agent

Include both rules **verbatim** in every finder and verifier prompt.

**Never guess — always verify:**

> **If you haven't read the file, you don't know what's in it.** Do not assume a function exists, a field is present, a pattern works a certain way, or a SQL query has a particular structure based on the plan's description alone. Open the file. Read the code. Confirm it yourself.
>
> This applies to everything:
> - The plan says "add to the existing const block" → Read the file. Is there a const block? What's in it?
> - The plan says "follows the same pattern as X" → Read X. Does the plan actually follow the pattern?
> - The plan says "update the CTE to..." → Read the full current SQL query. What does the CTE actually look like? Are there other CTEs the plan didn't mention?
> - The plan says "the interface has methods A and B" → Read the interface. Does it? Are there others?
> - The plan says "this struct has fields X, Y, Z" → Read the struct. Does it? Are there required fields the plan missed?
>
> **If you catch yourself thinking "that's probably right" — stop.** Open the file and check. Every "probably" is a potential bug that slips through.

**Question your own assumptions:**

> Before reporting an issue, re-read the relevant code to make sure YOU aren't the one who's wrong. Before clearing a section, ask: "Am I confident this is correct, or am I just not seeing the problem?" If a section of the plan is complex (SQL changes, multi-step data flow), trace through it step by step rather than reading it once and moving on.

---

## Phase 2 — Find Candidates (11 parallel finder angles)

Launch **11 finder agents via the Agent tool in a single message** so they run concurrently. Each agent's prompt contains: the plan file path, the inventory, both Core Rules verbatim, its full angle definition below, and this output contract:

> Return up to **6 candidate issues** as a JSON array. Each candidate:
> `{"location": "file/path.go:45 or plan step reference", "plan_claim": "what the plan says (quote or paraphrase)", "code_reality": "what the code actually shows, with file:line citations", "problem": "precise description of the gap", "proposed_severity": "BLOCKER | REQUIRED FIX"}`
> Every candidate must have a nameable, concrete problem — but pass every candidate with a nameable problem through, **even ones you only half-believe**. Finders that silently drop uncertain candidates bypass the verification step and are the dominant cause of missed issues. Return `[]` if your angle genuinely finds nothing.

Finders are read-only reviewers: they Read, Grep, Glob, and run read-only shell commands; they never edit files.

### Angle 1 — Claim Verifier

Verify the plan's factual claims against the actual code. **Do not trust the plan's claims — verify them against the actual code.**

1. **Verify all files mentioned in the plan exist** (use Glob). Report missing files as candidates.
2. **Verify method/function names referenced actually exist** (use Grep):
   - Check interface signatures match what's claimed — read the actual signature, compare parameter types and return types
   - Check struct fields match what's claimed — read the actual struct definition
   - Check constructor signatures match what's claimed — read the actual constructor
3. **Verify mock names exist** if the plan references mocks:
   - Check `internal/test/mocks/` for referenced mock types
   - Check `.mockery.yaml` for mock configuration

### Angle 2 — Data-Flow & SQL Tracer

Trace data flow end-to-end and verify SQL and interface contracts:

- Trace every struct from creation to consumption — if a struct is created in step X and consumed in step Y, verify ALL required fields are populated
- If a SQL query is modified, **read the FULL current query** — every CTE, every JOIN, every WHERE clause. Check that the plan accounts for ALL of them, not just the ones it mentions. The most dangerous bugs hide in the parts the plan doesn't talk about.
- Check that parameter references ($1, $2, etc.) are updated when the query signature changes
- Verify JOIN conditions are complete when scope changes (e.g., single-location to multi-location)
- Check for self-referencing issues in exclusion logic
- If an interface changes, verify ALL implementations are updated (concrete types, mocks, stubs, inmemory) and every caller is updated
- When constructors change, are ALL call sites updated?
- Do return types match what callers expect?
- **Verify cross-step consistency**: if a struct is defined in one step and used in another, compare the field names and types between steps — they must match exactly. If a method signature is defined in one step and called in another, compare parameters and return types — they must match exactly. If an idempotency key or message format is defined in one step and parsed in another, verify the format is identical in both directions. Do not assume consistency — check it. Plans are written by humans who can contradict themselves between steps.

### Angle 3 — Blast-Radius & Removed-Behavior Auditor

Hunt for ripple effects — what the plan DOESN'T mention:

- When the plan **deletes** a file, method, or interface method: Grep for every reference to it across the codebase. If anything else depends on the deleted thing and the plan doesn't account for it, that's a candidate. Deletions are not safe just because the plan says they are.
- **Removed-behavior audit**: for every guard, validation, error path, fallback, or test the plan removes or replaces, name the invariant or behavior it enforced, then search the planned new code for where that invariant is re-established. If you can't find it, that's a candidate: a removed guard, a dropped error path, a narrowed validation, a deleted test that was covering a real case.
- When the plan **changes** an interface, struct, or function signature: Grep for every caller, every implementation, every test that references it. If the plan only updates some of them, the rest will break.
- When the plan **modifies a query** that feeds data to other code: Read the code that consumes the query results. If the result shape changes (new fields, removed fields, different types), verify all consumers are updated.
- When the plan **modifies a scheduler API endpoint** (request body, response shape, URL, or behavior): Grep across the entire monorepo — especially `scheduler-admin/src/app/api/`, `ai-receptionist/`, and `flossy-hq/` — for callers of that endpoint. If any external consumer is affected and not addressed in the plan, that's a candidate. This is a monorepo with tightly coupled services; changes don't stop at package boundaries.
- Ask: "What files or code paths SHOULD be in this plan but aren't?" The plan's scope is a claim — verify it by searching for what it might have missed.

### Angle 4 — Narrative, Pattern & Design Auditor

Verify the plan's story and its design fit:

- **Verify the plan's description of current behavior**: if the plan describes how the system currently works as motivation for the change (e.g., "currently, recalls are processed synchronously"), trace the actual code path to confirm. The plan's framing of the problem shapes the solution — if the framing is wrong, the solution is wrong. This is different from verifying signatures and file paths; this is verifying the plan's *narrative*.
- **Verify patterns match existing code**: read at least one existing example of the pattern being followed (e.g., an existing cron job, processor, etc.). Compare the plan's approach against the actual pattern, not just what the plan claims the pattern is. Check how the pattern is wired in at the call site — initialization, config, registration.
- **Design alignment**: Does the plan match the stated intent of the change? Does it follow CLAUDE.md principles (OCP, LSP, DIP, KISS, YAGNI)? Does it match existing patterns in the codebase?
- **Conventions**: find the CLAUDE.md files that govern the touched code — the repo-root CLAUDE.md plus any CLAUDE.md in an ancestor directory of a touched file. Read each one, then check the plan for clear violations of the rules they state. Only flag a violation when you can quote the exact rule and the exact plan step that breaks it — no style preferences, no vague "spirit of the doc" inferences. In the candidate, name the CLAUDE.md path and quote the rule.

### Angle 5 — Concurrency Auditor

Concurrency is one of the hardest classes of bugs to catch in review. Do not hand-wave "Will race conditions occur?" — trace the specific scenarios:

- **Cron job overlap**: If the plan introduces a cron job, what happens if the previous run hasn't finished when the next one starts? Is there a distributed lock, a guard query, or an explicit "skip if already running" mechanism? If not, two runs can process the same data concurrently.
- **Queue consumer concurrency**: If multiple workers can process the same message type, can two workers pick up related messages and conflict? (e.g., two recall messages for the same patient processed simultaneously)
- **Read-then-write races (TOCTOU)**: If the plan reads data, makes a decision, then writes — what happens if another process modifies the data between the read and write? Is the check-and-act atomic (single transaction, SELECT FOR UPDATE, etc.)?
- **Transaction isolation**: If the plan's correctness depends on not seeing concurrent writes mid-query, is the transaction isolation level sufficient? READ COMMITTED (Postgres default) can see changes committed by other transactions between statements within the same transaction.

Also verify step dependencies are correct and complete, and the execution order is logical.

### Angle 6 — Migration, Deployment & Wiring Auditor

**Migration safety** (if applicable). Database changes are among the riskiest changes in the codebase — hard to reverse, easy to get wrong, and capable of taking down production. Before reviewing *how* the migration works, first question *whether it's necessary at all*:

- **Is the migration actually required?** Can the goal be achieved without schema changes — by using existing columns, adding application-level logic, or repurposing existing infrastructure? A new column or table is permanent complexity. If the plan introduces schema changes, the burden is on the plan to justify why they're necessary.

If the migration is justified, verify:

- **Backward compatibility**: During a rolling deploy, old code will run against the new schema. Will it break? Adding a nullable column or a new table is safe. Renaming a column, dropping a column, or adding a NOT NULL column without a default is not — old code will fail on the new schema.
- **Locking risk**: `ALTER TABLE` on a large table can lock it for the duration. Does the plan account for table size? For large tables, consider strategies like adding columns as nullable first, backfilling, then adding constraints.
- **Data backfill correctness**: If the migration populates a new column from existing data, is the backfill query correct for ALL existing rows? What about NULL values, edge cases in the source data, or rows that don't meet assumptions?
- **Reversibility**: If the migration fails or causes issues, can it be rolled back? Does the plan include a down migration? If the migration is destructive (drops a column, deletes data), flag that explicitly.

**Deployment compatibility.** Changes don't go live atomically — during deployment, old and new code coexist:

- **Schema + code ordering**: If the plan has both a migration and code changes, what deploys first? Can old code handle the new schema? Can new code handle the old schema (if the migration hasn't run yet)?
- **Message format changes**: If the plan changes a message/event schema, old producers may still emit old-format messages while new consumers expect the new format (and vice versa). Both directions must work.
- **API contract changes**: If the plan changes an API response shape, are existing callers (scheduler-admin, ai-receptionist) updated in the same deploy? If not, will they break during the window?
- **Feature flags**: If the change is risky or must be gradually rolled out, does the plan include a feature flag? If so, is the flag wired into config and is the off-state behavior specified?

**Configuration & wiring:**

- Are all new config fields documented with env var names and defaults?
- Are new topics/processors/cron jobs wired into the startup paths?
- Will worker counts, feature flags, or other runtime config be set correctly?

### Angle 7 — Corner-Case & Error-Handling Auditor

The plan must demonstrate that corner cases have been thought through. If the plan hand-waves, says "handle errors appropriately," or simply doesn't mention what happens in non-happy-path scenarios, that is a gap. Surface it.

**Data corner cases:**
- What happens with empty inputs — zero results from a query, empty batches, no candidates found?
- What happens with nil/null values — nullable DB columns, optional struct fields, nil pointers?
- What happens at boundaries — first page, last page, exactly-full page, single-item result, zero-item result?
- What happens with duplicate data — same record processed twice, idempotency key collision, concurrent writes?

**Failure corner cases:**
- What happens when a DB query fails mid-pagination — partial work already done, is it safe to retry?
- What happens when message publishing fails — are already-published messages orphaned? Does the next cron run re-enqueue?
- What happens when a processor fails on one message — does it block the queue? Is the retry strategy explicit?
- What happens during deployment — old code processing new messages, new code processing old messages?

**Business logic corner cases:**
- Are time zone assumptions explicit? (UTC vs local, DST transitions)
- Are date boundary conditions handled? (exactly N months ago, leap years, month-end dates)
- Are there patients/records that straddle conditions? (e.g., appointment that is both the "last appointment" and a "recent appointment")
- What about data that technically meets criteria but shouldn't be acted on? (test patients, inactive records, edge status values)

**If the plan doesn't address a relevant corner case, it's a candidate.** The implementer shouldn't have to discover these during coding — the plan should have already decided how to handle them.

### Angle 8 — Half-Measures Auditor

Plans sometimes cut corners by deferring work that should be done now. This produces code that looks finished but isn't — and the "iterate later" follow-up never comes. Watch for these patterns and surface them:

- **Stub pagination**: The plan calls a paginated API or query but only fetches the first page, logging a warning if there's more. If the work requires consuming all pages, the plan must loop through all pages. "Log and move on" is not pagination.
- **Placeholder error handling**: The plan says "handle errors" or "log and continue" without specifying what actually happens to the failed work. If a message fails to process, what's the retry strategy? If a batch fails mid-way, what happens to the partial results?
- **Deferred-to-later logic**: The plan implements the happy path and says "we'll handle X in a follow-up." If X is required for correctness (not a separate feature), it belongs in this plan. A recall system that enqueues candidates but has no plan for what happens when enqueuing fails is not a complete system.
- **Fake interfaces**: The plan creates an interface with a no-op implementation and no concrete path to a real one. A no-op is acceptable ONLY when the real implementation depends on external work (e.g., a Firebase function that another team builds). Otherwise, the plan should implement the real thing.
- **Missing consumption of data**: The plan produces data (writes to a queue, returns from an API, generates a list) but doesn't fully specify who consumes it and how. Every output must have a consumer. Every consumer must handle the full range of outputs.
- **"Good enough" filtering**: The plan filters data with an incomplete set of conditions because the full set is complex. If the business logic has 5 conditions, the plan must address all 5 — not 3 with a TODO for the rest.

**The test**: Read each step and ask — "If this ships exactly as described, will it work correctly in production with real data at real scale, or does it depend on future work that isn't planned?" If it depends on unplanned future work for correctness, it's incomplete.

### Angle 9 — Test-Robustness Auditor

Tests are as critical as the code itself — possibly more so. Untested code is a liability; tested code with gaps in coverage is a false sense of security. Review the testing plan with the same rigor as the implementation plan.

**Before evaluating tests, read the existing test files** referenced by the plan. Understand the testing conventions, patterns, and level of rigor the codebase already maintains. The plan's tests should match or exceed that bar.

**Coverage analysis — map every behavioral change to a test:**
- List every new code path introduced by the plan (new functions, new branches, new error handlers, new state transitions)
- For EACH code path, verify that a specific test exercises it. If a code path has no corresponding test, that's a candidate.
- Pay special attention to the plan's own emphasis. If the plan dedicates a paragraph to describing a mechanism (race condition guard, retry logic, fallback behavior), that mechanism MUST have dedicated tests proportional to its complexity.

**The "wrong implementation" test:**
- For each test, ask: "Could a subtly wrong implementation pass this test?" If the answer is yes, the test is insufficient.
- Example: A plan says "extract data from both field A and field B." If all tests only put data in field A, an implementation that ignores field B passes every test. The test plan must include cases where data is ONLY in field B.
- Example: A plan says "deduplicate results." If all tests have unique inputs, an implementation without dedup passes every test. The test plan must include duplicate inputs.

**Error path coverage:**
- Every error handling branch in the implementation plan needs a test that triggers it
- If the plan says "error handling mirrors X" — verify the test plan covers every error branch that X has, not just some of them
- External API calls (database, HTTP, SDK) can fail. Every external call site needs a failure test.

**State and concurrency testing:**
- If the plan introduces shared mutable state (caches, registries, locks, guard sets), test the lifecycle: initialization, normal operation, cleanup, and edge cases (double-cleanup, use-after-cleanup)
- If the plan describes a race condition or TOCTOU guard, the test plan MUST include a concurrency test that demonstrates the guard works. A race condition guard without a test is an untested code path — treat it the same as a missing test for any other branch.

**Integration boundary testing:**
- When the plan adds a new external call (third-party API, database query, HTTP request), test both the success path AND at least one failure mode (timeout, error response, malformed data)
- When the plan processes external data (parsing messages, extracting fields from API responses), test with realistic data shapes — not just clean synthetic data. If the external system sends data in a specific structure, test with that structure.

**What NOT to flag:**
- Don't demand tests for trivial code (simple assignments, straightforward delegation)
- Don't demand tests that duplicate existing coverage in the codebase
- Don't flag missing tests for code paths that are genuinely unreachable
- If the existing codebase has no tests for a comparable feature, don't hold the plan to a higher standard than the codebase itself — but DO note the gap as context

**The standard:** After implementation, if a regression is introduced in ANY code path the plan touches, would the test suite catch it? If there are code paths where the answer is "no," those are testing gaps — candidates.

### Angle 10 — Quality Auditor (Reuse, Simplification, Efficiency, Altitude)

Correctness bugs always outrank these findings, but a plan that bakes in duplication or waste is a plan that should be fixed before implementation, not after:

- **Reuse**: Flag planned code that re-implements something the codebase already has — Grep shared/utility modules and files adjacent to the change, and name the existing helper the plan should call instead.
- **Simplification**: Flag unnecessary complexity the plan introduces: redundant or derivable state, copy-paste with slight variation, deep nesting, steps that leave dead code behind. Name the simpler form that does the same job.
- **Efficiency**: Flag wasted work the plan introduces: redundant computation or repeated I/O (e.g., re-querying data a prior step already fetched), independent operations planned sequentially when they could run concurrently, blocking work added to startup or hot paths (availability calculation, request handlers). Name the cheaper alternative.
- **Altitude**: Check that each change is planned at the right depth, not as a fragile bandaid. Special cases layered on shared infrastructure are a sign the fix isn't deep enough — prefer generalizing the underlying mechanism over adding special cases. If the plan patches a symptom in a caller when the defect lives in a shared function, that's a candidate.

In `problem`, state the concrete cost (what is duplicated, wasted, or harder to maintain) — not a style preference.

### Angle 11 — Completeness Critic

The final angle asks "what's missing?":

- Does the plan cover ALL stated requirements? Re-read the original task/ticket if referenced and diff it against the plan.
- Are vague sections ("Apply Same Pattern") fully specified with file paths and concrete changes?
- Is every file that needs modification listed?
- Are test cases comprehensive enough to catch regressions?
- Are there typos, syntax errors, or missing characters in code snippets? Do variable names match between definition and usage? Are shell commands properly quoted and escaped?
- What would none of the other angles have looked at — is there anything in the plan that falls between their scopes?

---

## Phase 3 — Adversarial Verification

Collect all candidates from the finders. **Dedup near-duplicates** (same gap, same location, same reason → keep one, merging the strongest evidence). Different angles finding the same issue is corroboration — note it, but report the issue once.

For each surviving candidate, launch **one verifier agent** via the Agent tool — all in a single message so they run in parallel. Each verifier gets: the plan file path, the full candidate, both Core Rules verbatim, and these instructions:

> Your job is to try to **REFUTE** this candidate issue against the actual codebase and the actual plan text. Read the code yourself — do not trust the finder's citations. Provide concrete proof for whatever you conclude:
>
> 1. **Run the code** — execute shell commands, test regex patterns, or simulate the logic to demonstrate the failure (or its impossibility)
> 2. **Show the evidence** — include the actual code, line numbers, or output
> 3. **Compare with fix** — for confirmed issues, show what the corrected version should look like
>
> Return exactly one verdict:
>
> - **CONFIRMED**: You independently reproduced the gap. Quote the plan text and the code (file:line) that prove it.
> - **PLAUSIBLE**: You could not fully prove it, but the scenario is realistic and you could not refute it. Do NOT refute a candidate merely for being "speculative" or "depends on runtime state" when the state is realistic: concurrency races, nil on a rare-but-reachable path (error handler, cold cache, missing optional field), boundary conditions the plan does not exclude, partial failures, deployment windows. These are PLAUSIBLE.
> - **REFUTED**: Only when constructible from the code or plan — the claim is factually wrong (quote the actual line), provably impossible (type/constant/invariant — show it), already addressed in the plan (quote the plan section that handles it), or pure wording/style preference with no effect on implementation.
>
> Return: `{"verdict": "CONFIRMED | PLAUSIBLE | REFUTED", "evidence": "quotes, file:line citations, command output", "severity": "BLOCKER | REQUIRED FIX", "required_change": "the exact fix needed in the plan"}` — you may adjust the finder's proposed severity if the evidence warrants it.

**Keep CONFIRMED and PLAUSIBLE. Drop REFUTED.** PLAUSIBLE issues are reported labeled **Unverified**, with the verifier's reasoning — they still count as issues and still block approval.

---

## Avoiding Template-Filling

**Do NOT manufacture issues that don't exist.** A truly airtight plan should be approved.

- Don't invent problems from wording preferences or style choices
- Don't report issues that cannot be proven or made plausible against the actual codebase
- If the plan is genuinely complete and correct, say so and approve it

**But do NOT dismiss real issues as "minor" or "nice to have."** If something is wrong, it's wrong. If something is missing, it's missing. There is no "minor" category.

---

## Severity: Two Tiers Only

Every issue falls into one of two categories. **There is no "minor" or "nice to have" tier.** If it survived verification, it's worth fixing.

- **BLOCKER**: Will cause the implementation to fail, produce incorrect results, not compile, or miss requirements. The plan cannot be implemented as written. Examples: wrong file path, incorrect function signature, missing SQL clause, broken data flow, missing step.

- **REQUIRED FIX**: Won't catastrophically break things, but will cause problems: missing edge cases, incomplete specifications, gaps in test coverage, config that won't be wired up, patterns that diverge from codebase conventions, duplication or waste baked into the design. These MUST be addressed before implementation.

**The test**: "If this issue is not addressed, will the implementer have to stop mid-implementation to figure it out, fix a bug, or make a decision that should have been in the plan?" If yes, it's an issue.

---

## Phase 4 — Output Format

Rank issues most-severe first: BLOCKERs before REQUIRED FIXes; within a tier, CONFIRMED before Unverified; correctness before quality (reuse/simplification/efficiency/altitude). **Every issue is numbered and actionable. Every issue MUST be resolved.**

For an **airtight plan with no surviving issues** — give a confident, substantive approval that shows what was verified:
```
## Verdict: APPROVED

The plan is airtight and ready to implement.

### What was verified
- [List the key things checked across all angles: files exist, interfaces match, SQL traced end-to-end, data flow complete, patterns match existing code, blast radius clear, etc.]
- [Be specific — "Verified `GetAllRecallCandidates` signature matches plan's Step 4a" not just "checked interfaces"]
- [Note candidates that were raised and refuted — a refuted candidate is evidence the review looked hard]

### Strengths (optional — only if genuinely notable)
- [Call out things the plan does particularly well: good pagination strategy, clean separation of concerns, thorough test coverage, etc.]
```

**An APPROVED verdict is earned, not given.** When the plan genuinely survives eleven independent angles and adversarial verification, say so with confidence. The approval carries weight precisely because the review was thorough.

For a **plan with issues**:
```
## Verdict: NOT APPROVED — X issue(s) must be resolved

### Issue 1: [Short description]
**Severity**: BLOCKER | REQUIRED FIX
**Verification**: CONFIRMED | Unverified (plausible — <verifier's reasoning>)
**Location**: `file/path.go:45`
**What the plan says**: <quote or paraphrase from plan>
**What actually exists**: <what the code actually shows, with file:line evidence>
**Problem**: <precise description of the gap>
**Required change**: <exact fix needed in the plan>

### Issue 2: [Short description]
...
```

Every issue MUST include:
- **Severity** (BLOCKER or REQUIRED FIX)
- **Verification** (CONFIRMED, or Unverified with reasoning)
- **Location** (file path + line number when applicable)
- **Problem** (precise, evidence-backed description)
- **Required change** (specific fix, not vague guidance)

---

## Writing Feedback

After completing the review, write the feedback to a file. You (the orchestrator) write this file yourself with the Write tool — do not delegate it to an agent.

**The feedback file MUST be written to `~/.claude/feedback/`** (i.e., `$HOME/.claude/feedback/` — use the absolute expanded path with the Write tool). This is where the `/feedback` skill reads it from. Do NOT write it to the scratchpad, a tmp directory, or the repo — the general guidance to put outputs in the scratchpad does not apply to this file; a feedback file anywhere else is invisible to `/feedback` and the review is lost.

**Note**: The `~/.claude/feedback/` directory already exists. Do not attempt to create it.

1. **Write feedback file** using the same filename as the plan:
   - Plan: `~/.claude/plans/keen-dreaming-stallman.md`
   - Feedback: `~/.claude/feedback/keen-dreaming-stallman.md`
   - If the plan was passed as inline text with no filename, derive one from the plan's title (kebab-case) and tell the user the exact path you wrote.

2. **Feedback file format**:
   ```markdown
   # Plan Review Feedback

   **Plan**: <plan filename>
   **Reviewed**: <current date/time>
   **Verdict**: <APPROVED | NOT APPROVED>

   ---

   <your full review output here>
   ```

3. **Verdict criteria**:
   - **APPROVED**: Zero surviving issues of any kind. The plan is airtight and ready to implement.
   - **NOT APPROVED**: Has ANY surviving issues (CONFIRMED or Unverified). Every issue must be resolved before implementation begins.

4. **Overwrite** any existing feedback file for this plan (each review replaces the previous).

5. **Notify the user** that feedback has been written and they can share the plan with the author to run `/feedback`.

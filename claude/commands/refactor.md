---
description: Safe refactoring workflow with test verification
---

Refactor the following while maintaining correctness: $ARGUMENTS

## Step 1: Understand Current State
- Read the code to be refactored
- Identify what it does and its responsibilities
- Note all callers and dependencies

## Step 2: Verify Test Coverage
- Check existing tests cover the code
- Run tests to establish a green baseline: `./bin/test.sh ./internal/<package>`
- If coverage is insufficient, write tests FIRST before refactoring

## Step 3: Plan the Refactoring
- What specific improvement is being made?
- Keep changes focused on ONE refactoring goal:
  - Extract function/method
  - Rename for clarity
  - Simplify conditionals
  - Remove duplication
  - Improve structure
- Do NOT change behavior

## Step 4: Make Small Changes
- One small change at a time
- Run tests after EACH change
- If tests fail, revert and try a smaller step

## Step 5: Verify
- All tests still pass
- Run `./bin/check.sh` for lint errors
- Code is cleaner and maintains the same behavior
- No unrelated changes were made

## Rules
- Never refactor and change behavior in the same step
- Tests must stay green throughout
- If you're unsure, make a smaller change
- Stop if you find yourself touching unrelated code

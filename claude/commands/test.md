---
description: Write tests for existing untested code
---

Write tests for: $ARGUMENTS

## Step 1: Analyze the Code
- Read and understand what the code does
- Identify public functions/methods that need testing
- Note dependencies that may need mocking

## Step 2: Identify Test Cases
- Happy path scenarios
- Edge cases (empty inputs, boundaries, nil values)
- Error conditions and failure modes
- Any business logic branches

## Step 3: Check Existing Patterns
- Look at existing tests in the same package
- Use the same test utilities and helpers
- Follow the `_test` package suffix convention (black-box testing)
- Check `internal/test/mocks/` for existing mocks

## Step 4: Write Tests
- Use table-driven tests where appropriate
- Use subtests (`t.Run`) for granularity
- Prefer `NewTxTestDB(t)` unless test requires connection pools or concurrent access
- Keep tests focused and independent

## Step 5: Verify
- Run tests: `./bin/test.sh ./internal/<package> -run "TestName"`
- Ensure all tests pass
- Check that tests actually exercise the code paths intended

Use descriptive test names that explain the scenario being tested.

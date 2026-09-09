---
description: Test-driven development cycle for a feature or fix
---

Implement the following using strict TDD discipline: $ARGUMENTS

## RED: Write a Failing Test First
1. Understand the requirement
2. Write a test that captures the expected behavior
3. Run the test - confirm it fails for the right reason
4. Do NOT write implementation code yet

## GREEN: Make the Test Pass
1. Write the minimal code to make the test pass
2. No extra features, no premature optimization
3. Run the test - confirm it passes
4. Run related tests - confirm no regressions

## REFACTOR: Clean Up
1. Improve code quality while keeping tests green
2. Remove duplication, improve naming, simplify logic
3. Run tests after each refactoring step
4. Stop when the code is clean and all tests pass

## Rules
- Never write implementation before the test
- Never skip the refactor phase
- Keep tests fast and isolated
- One small cycle at a time

Run tests with: `./bin/test.sh ./internal/<package> -run "TestName"`

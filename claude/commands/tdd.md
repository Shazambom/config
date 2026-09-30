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

## Test quality

Write meaningful tests at every level. Assert the intended behavior, not merely that code ran or returned something. Check actual results against independently justified expectations, including relevant failure cases. Verify that the test fails when the behavior it protects is broken. Do not mock away the behavior being tested, weaken assertions to make a test pass, or change expected results without verifying the requirements. No Tautological tests: meaning tests that simple assert the existing behavior. Tests must be meaningful and actually represent the behavior between boundaries regardless of how variables are set. Do not cut corners or claim coverage the test does not provide.

## Rules
- Never write implementation before the test
- Never skip the refactor phase
- Keep tests fast and isolated
- One small cycle at a time

Run tests with: `./bin/test.sh ./internal/<package> -run "TestName"`

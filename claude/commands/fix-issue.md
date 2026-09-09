---
description: Analyze and fix a GitHub issue by number
---

Fix GitHub issue: $ARGUMENTS

## Step 1: Understand the Issue
- Use `gh issue view $ARGUMENTS` to get issue details
- Read the description, comments, and any linked PRs
- Identify acceptance criteria

## Step 2: Investigate
- Find the relevant code areas
- Understand the current behavior
- Identify the root cause

## Step 3: Write a Failing Test
- Create a test that reproduces the issue
- Confirm the test fails as expected
- This proves the bug exists and will verify the fix

## Step 4: Implement the Fix
- Make the minimal change to fix the issue
- Keep changes focused - no scope creep
- Follow existing code patterns

## Step 5: Verify
- Run the new test - confirm it passes
- Run related tests - confirm no regressions
- Run `./bin/check.sh` for lint errors

## Step 6: Summary
- Explain what was wrong
- Explain how it was fixed
- Note any follow-up work needed

Ask for clarification if the issue is ambiguous or underspecified.

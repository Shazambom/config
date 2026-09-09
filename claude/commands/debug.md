---
description: Structured debugging workflow for an issue
---

Debug the following issue using a systematic approach: $ARGUMENTS

## Step 1: Understand the Problem
- What is the expected behavior?
- What is the actual behavior?
- What error messages or symptoms are present?

## Step 2: Reproduce
- Identify the minimal steps to reproduce
- Find or write a test that demonstrates the failure

## Step 3: Isolate
- Trace the code path that leads to the issue
- Identify the root cause (not just symptoms)
- Check recent changes that might have introduced this

## Step 4: Fix
- Propose the minimal fix that addresses the root cause
- Consider edge cases and side effects
- Ensure the fix doesn't break existing functionality

## Step 5: Verify
- Run the failing test to confirm it passes
- Run related tests to ensure no regressions
- Document what was wrong and how it was fixed

Ask clarifying questions if the issue description is unclear.

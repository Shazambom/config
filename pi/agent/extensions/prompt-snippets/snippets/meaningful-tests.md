---
name: Meaningful tests
description: Test the intended behavior with assertions that catch real failures.
placement: append
order: 25
---
Write meaningful tests at every level. Assert the intended behavior, not merely that code ran or returned something. Check actual results against independently justified expectations, including relevant failure cases. Verify that the test fails when the behavior it protects is broken. Do not mock away the behavior being tested, weaken assertions to make a test pass, or change expected results without verifying the requirements. Do not cut corners or claim coverage the test does not provide.

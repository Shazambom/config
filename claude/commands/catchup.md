---
description: Reload work-in-progress context after clearing conversation
---

Reload the current work-in-progress context to continue where you left off.

1. **Uncommitted changes**: Run `git status` and `git diff` to see all pending work
2. **Recent commits**: Run `git log -5 --oneline` to see recent history on this branch
3. **Branch context**: Identify what feature/fix this branch is for from the branch name
4. **Staged changes**: Run `git diff --cached` to see what's ready to commit

Summarize:
- What work is in progress
- What has been completed on this branch
- What likely remains to be done

Then ask if there's anything specific to focus on.

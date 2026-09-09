---
description: Check reviewer feedback on your implementation plan
---

You have submitted an implementation plan for review. A reviewer has analyzed your plan and left feedback. Read and understand the feedback to determine next steps.

## Finding the Feedback

1. **If $ARGUMENTS is provided**: Use it as the plan filename to find feedback for
2. **If $ARGUMENTS is empty**: Find the most recent plan file you're working on:
   ```bash
   ls -t ~/.claude/plans/*.md | head -1
   ```
   Extract just the filename (e.g., `keen-dreaming-stallman.md`).

3. **Read the feedback file** at `~/.claude/feedback/<plan-filename>.md`

## If Feedback Exists

1. **Read the feedback file**
2. **Also read the plan file** (`~/.claude/plans/<plan-filename>.md`) so you have full context

Present the feedback to the user with this format:

```
## Plan Review Feedback Received

**Your plan**: <plan filename>
**Review iteration**: <N>
**Review status**: <Approved | Needs Changes | Blocked>

---

<feedback content>

---

### Next Steps

Based on the feedback status:
- **Approved**: You can proceed with implementation
- **Needs Changes**: Address the issues below, update your plan, and request another review
- **Blocked**: Critical issues must be resolved before proceeding
```

## If No Feedback Exists

Tell the user:
```
No feedback found for plan: <plan filename>

The reviewer may not have completed their review yet, or the feedback file may be at a different location.

Expected feedback location: ~/.claude/feedback/<plan-filename>.md
```

## After Reading Feedback

If status is **Approved**:
- Congratulate the user and confirm they can proceed with implementation
- Delete the feedback file: `rm ~/.claude/feedback/<plan-filename>.md`

If status is **Needs Changes** or **Blocked**:

### Step 1: Prepare All Fixes

First, analyze ALL issues and prepare proposed fixes. For each Critical and Moderate issue:
1. Read the relevant section of the plan
2. Prepare a specific fix (exact text replacement)
3. Store the fix details for batch presentation

### Step 2: Present Fixes for Batch Approval

Present ALL proposed fixes at once, then use `AskUserQuestion` with `multiSelect: true` to let the user choose which to apply:

```
## Proposed Fixes

I've prepared fixes for N issues. Review each and select which to apply:

### Fix 1: [Category] - <brief description>
**Problem**: <from feedback>
**Current** (line X): `<current text snippet>`
**Proposed**: `<new text snippet>`

### Fix 2: [Category] - <brief description>
**Problem**: <from feedback>
**Current** (line X): `<current text snippet>`
**Proposed**: `<new text snippet>`

... (all fixes)
```

Then call AskUserQuestion:
```
{
  "questions": [{
    "question": "Which fixes should I apply to your plan?",
    "header": "Apply fixes",
    "multiSelect": true,
    "options": [
      {"label": "Fix 1: <brief desc>", "description": "<category> - <one-line summary>"},
      {"label": "Fix 2: <brief desc>", "description": "<category> - <one-line summary>"},
      ...up to 4 options per question
    ]
  }]
}
```

**Note**: If there are more than 4 fixes, use multiple questions (4 fixes per question).

### Step 3: Apply Approved Fixes

After user responds:
1. Apply ONLY the fixes they selected using Edit tool
2. Apply them in order (top-to-bottom in the plan file to avoid line number shifts)

### Step 4: Summary

After applying:
```
## Changes Applied

Applied N of M proposed fixes:
- ✅ Fix 1: <description>
- ✅ Fix 3: <description>
- ⏭️ Fix 2: Skipped (not selected)

**Next**: Request `/plan-review` for iteration N+1
```

### Step 5: Clean Up Feedback File

After presenting the summary, delete the feedback file:
```bash
rm ~/.claude/feedback/<plan-filename>.md
```

This ensures each review cycle starts fresh and old feedback doesn't persist.

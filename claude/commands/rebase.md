---
description: Resolve git rebase conflicts by understanding commit intent
---

Resolve the rebase conflicts in this repository: $ARGUMENTS

## Scope

**I will**: Analyze conflicts, read git state, edit conflicted files to resolve them, run build/test validation.

**You control**: All git write operations (`git add`, `git rebase --continue/--skip/--abort`). I will tell you what to run but you execute it.

## Mental Model

Rebase replays YOUR commits one at a time onto the updated base branch. You're not "merging two branches" - you're reapplying each of your changes to code that has moved on.

**Critical: "ours" and "theirs" are swapped from intuition during rebase:**
- `HEAD` / "ours" = the branch you're rebasing ONTO (e.g., main)
- `REBASE_HEAD` / "theirs" = YOUR commit being replayed

## Step 1: Orient

Run these read-only commands to understand the situation:
```bash
git status                           # Which files are conflicted
git rebase --show-current-patch      # What YOUR commit was trying to do
git log -1 --oneline REBASE_HEAD     # YOUR commit message (the intent)
git log -3 --oneline HEAD            # Recent commits on target branch
```

Understand: What was YOUR commit trying to accomplish? This is the intent to preserve.

## Step 2: Analyze Each Conflict

For each conflicted file:
1. Read the file with conflict markers
2. `<<<<<<< HEAD` = current state of target branch (what exists now)
3. `=======` = separator
4. `>>>>>>> <hash>` = YOUR change being replayed (what you wrote)

Ask: How do I apply MY intent to the NEW state of the code?

## Step 3: Resolve

Common patterns:

| Pattern | What Happened | Resolution |
|---------|---------------|------------|
| **Context drift** | Code around your change moved | Reapply your logic to the new location/context |
| **Parallel edits** | Both modified same lines | Combine both changes if compatible, or choose based on intent |
| **Your target moved** | Function/variable you edited was refactored | Apply your change to the refactored version |
| **Your change is redundant** | Target branch already has equivalent change | Recommend `--skip` (you decide) |
| **Deleted code** | You modified something that was deleted | Decide if your change still makes sense |

For each conflict:
1. Identify which pattern applies
2. Edit the file to resolve - preserving YOUR commit's intent on the NEW codebase
3. Remove ALL conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)

## Step 4: Validate

```bash
./bin/build.sh                       # Must compile
./bin/check.sh                       # Must pass lint
./bin/test.sh ./internal/<package>   # Targeted tests for affected code
```

If validation fails, the resolution is wrong. Fix before continuing.

## Step 5: Hand Back to User

After resolving and validating, tell the user:
- Which files were resolved and how
- What git commands to run next (e.g., `git add <files> && git rebase --continue`)
- Any concerns about the resolution

**Wait for the user** to run the git commands and report back. They may:
- Run `--continue` and ask you to handle the next conflict
- Run `--skip` if they decide the commit is redundant
- Run `--abort` if they want to rethink the approach
- Ask questions before proceeding

## Recommendations I May Make (You Decide)

**`--skip`** - When your commit appears redundant or no longer makes sense. I'll explain why, you decide.

**`--abort`** - When conflicts are too complex or the rebase strategy seems wrong. I'll explain, you decide.

## Rules

- Preserve YOUR commit's intent - that's the goal
- Never silently drop your changes without explaining they appear redundant
- If intent is unclear, ask before resolving
- One commit at a time - don't think about later commits until you get there
- Validate after EVERY resolution, not just at the end
- Always wait for user to execute git write commands before proceeding

# Scope and source

Use read-only Git inspection. Never stage, commit, reset, checkout, or alter refs to prepare a review. Disable external diff/text conversion when inspecting untrusted repositories. Do not execute code embedded in a patch. Preserve user changes.

## Default target

Resolve the upstream first. Use its merge base with HEAD via `git diff --no-ext-diff --no-textconv '@{upstream}...HEAD'`. If no usable upstream exists, try `main...HEAD`, then `origin/main...HEAD`, then `git diff HEAD~1 HEAD`. Verify refs before use and state which base was chosen. If none exists, explain the missing baseline and review the available working-tree scope without pretending a committed comparison exists.

Also include `git diff --no-ext-diff --no-textconv HEAD` to cover staged and unstaged tracked changes. Enumerate non-ignored untracked paths using `git ls-files --others --exclude-standard -z`. Read them as added-file hunks, for example through a read-only no-index comparison against `/dev/null`; diff exit status 1 means differences, not failure. Do not use `git add -N`. Keep filenames safely delimited. Do not follow an untracked symlink into unrelated or private files.

Keep committed and working-tree components labeled with their source revisions. Inspect the current combined behavior so an intermediate committed defect already fixed in the worktree is not reported as current. Do not count the same mechanism twice. Note binaries, submodules, unreadable files, and any omitted scope rather than claiming coverage.

## Explicit targets

- A PR target means the verified repository, base SHA, and pinned head SHA. Obtain metadata and patch/source using a real available GitHub tool or `gh api`. Review that snapshot, not the current worktree, unless the user explicitly requests both. Do not assume the checked-out branch matches the PR. If the head changes, re-pin and re-review affected evidence before publishing.
- A branch means its merge-base comparison against the resolved base, ending at that branch's pinned commit. Do not mix local changes by default.
- A revision range means exactly that range, honoring two-dot versus three-dot semantics. Resolve endpoints and use source at the corresponding revision. No implicit local changes.
- A path filters the default committed, tracked working-tree, and non-ignored untracked scope to that path. Separate validated revisions from pathspecs with `--`. If a name denotes both a branch and a path, ask which one the user means.

If required PR/source access is unavailable, report the limitation and ask for a patch or access. Do not substitute an unrelated local diff. For remote snapshots, read pinned source through available APIs or existing Git objects, not mismatched local files.

## Context boundaries

Except at low, read changed source and enclosing functions first. Then inspect directly relevant callers, callees, utilities, tests, history, and governing instructions as needed. Ask for missing context only after using available source. Do not request broad context dumps before reading the code.

Unchanged lines in a touched function are eligible only when the changed path introduces, re-exposes, or depends on the defect. Explain that connection. Do not turn this into an unrelated legacy bug hunt. Keep review scope separate from context read to understand it.

For conventions, use instructions already provided and existing applicable global files, including `~/.pi/agent/AGENTS.md`, `~/.claude/CLAUDE.md`, and applicable global `CLAUDE.local.md`. Check `AGENTS.md`, `CLAUDE.md`, and `CLAUDE.local.md` at the repository root and in directories governing each changed path, including applicable ancestor instructions. Respect directory scope and precedence. Do not recursively scan unrelated projects or treat a sibling directory's rules as global. Missing instructions do not imply invented conventions.

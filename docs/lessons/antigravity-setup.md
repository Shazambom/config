# Antigravity setup

## Observed runtime contracts

Inspecting the installed T3 Code `antigravity-acp` runtime (`agy_acp_server.par`)
revealed two non-obvious constraints that shape deployment:

1. **Isolated `GEMINI_HOME` under T3 Code**: T3 Code spawns Antigravity with
   `GEMINI_HOME` pointing at `~/.t3/userdata/providers/antigravity/<hash>` rather
   than `~/.gemini`. `agy_acp_server.par` intentionally relocates
   `global_skills_paths()` (`<gemini_home>/config/skills` and
   `<gemini_home>/antigravity-cli/skills`) with `GEMINI_HOME` and does not read
   `~/.gemini/config/skills`. Deploying only to `~/.gemini` leaves T3 Code
   Antigravity sessions without any bundled skills.
2. **`realpath`-based `view_file` containment**: `agy_acp_server.par`'s
   `_view_file_scope_policy` checks `is_subpath(path, allowed_dir)` using
   `os.path.realpath()`, where `allowed_dirs` is `[cwd, additional_directories,
   gemini_home, *skills_dirs]`. Symlinking skills into this repository would
   resolve outside `allowed_dirs` whenever Antigravity works in another project,
   causing `view_file` denials on `SKILL.md` and skill references.

## Decisions

- `antigravity/setup.sh` deploys bundled `claude/skills/` as real directory
  copies (staged outside `skills/` and swapped cleanly) into both
  `$HOME/.gemini/config/skills` and every real provider directory under
  `$HOME/.t3/userdata/providers/antigravity/*`.
- Targets derive from `$HOME` rather than `$GEMINI_HOME`. Because T3 Code
  exports `GEMINI_HOME` into agent shells, reading `$GEMINI_HOME` would skip
  `$HOME/.gemini` during interactive runs and allow isolated tests setting only
  `HOME` to mutate the real T3 provider directory.
- All targets and bundled skill destinations are validated against symlinks and
  non-directory collisions before mutating any target.

## Runtime replacement (2026-11-24)

- Symptom: Antigravity stopped working in T3 Code. The server trace
  (`~/.t3/userdata/logs/server.trace.ndjson`, `AntigravityInstallation.*` spans)
  said "Antigravity 1.4.5 predates the Antigravity CLI and no longer works with
  this T3 Code release."
- Cause: a T3 Code update switched its managed runtime from `agy_acp_server.par`
  to Google's native CLI (executable `antigravity`). The old managed release under
  `~/.t3/tools/antigravity-acp/<platform>-<arch>/` is rejected. This repo did not
  cause it, and `init.sh` cannot fix it.
- Fix: in T3 Code, open Settings → Providers → Antigravity and choose Update or
  Reinstall. T3 owns this directory, so don't edit it by hand.
- After updating to CLI 1.5.16, a delegated Antigravity turn in T3 Code listed
  every bundled skill from `<GEMINI_HOME>/config/skills` and read a copied
  `SKILL.md` with no permission denial. Copying skills into the provider home
  still works. The realpath containment rule for symlinks was not retested on
  the new CLI.

## Verification and limits

- Sources: `init.sh`, `antigravity/setup.sh`, `antigravity/README.md`.
- Regression test: `bash antigravity/test-setup.sh` (tested under `/bin/bash`
  3.2) verifies multi-target deployment, `GEMINI_HOME` isolation, script mode
  preservation, updates with stale-file cleanup, custom skill preservation,
  upfront refusal paths, and `init.sh` dispatch.
- Unverified by static tests: live Antigravity session skill discovery requires
  starting a fresh Antigravity session after running `./init.sh --antigravity`.

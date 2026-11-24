# Antigravity skills deployment

Run `./init.sh --antigravity` to deploy the bundled skills from `claude/skills/`
into Antigravity without running Pi or Neovim setup. Default `./init.sh` runs
Pi, Antigravity, and Neovim.

## Targets

`antigravity/setup.sh` deploys to:

- `$HOME/.gemini/config/skills/` (standalone Antigravity App, IDE, and CLI)
- `$HOME/.t3/userdata/providers/antigravity/*/config/skills/` (T3 Code's isolated
  `GEMINI_HOME` directories for existing Antigravity provider instances)

Targets derive strictly from `$HOME` (not `$GEMINI_HOME`), so invoking setup
from inside a T3 Code Antigravity session still updates `$HOME/.gemini` and
isolated tests cannot escape their temporary `$HOME`.

## Behavior

- Copies each bundled skill directory as real files rather than symlinks.
  `antigravity-acp` checks `realpath` against its allowed directories (`cwd`,
  `gemini_home`, and `config/skills`), so symlinks into this repository would be
  denied by `view_file` in other workspaces.
- Rerunning `./init.sh --antigravity` updates bundled skills in place and removes
  stale files inside bundled skill directories while leaving unrelated custom
  skills and private config untouched.
- Refuses to deploy if any target path or bundled skill destination is a symlink
  or non-directory; all targets are validated before any files are modified.

Run `bash antigravity/test-setup.sh` for isolated deployment, update, refusal,
and `init.sh` dispatch checks. Start a new Antigravity session after deploying
so it discovers the updated skills.

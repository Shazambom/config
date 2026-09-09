# Portable nvim setup

Portable Neovim environment: clone on any machine, run `./init.sh`, get an
identical setup. One rule follows: **everything derives from `./init.sh`;
never hand-edit or hand-install anything on the local machine.**

- Config files (`init.vim`, `coc-settings.json`) live in this repo; `init.sh`
  copies them under `~`. Edit the repo file and rerun, never the deployed copy.
- Any new config file must be in the repo AND deployed by `init.sh`.
- Tools (vim-plug, coc extensions, gopls, tree-sitter CLI, parsers) install
  only via `init.sh`. Paths derive from `$HOME`; pin env vars when a path
  must match a config value (see the GOBIN line). Keep the script idempotent.
- Pin plugin branches in `init.vim` (nvim-treesitter's default-branch switch
  to `main` broke us), and use `PlugUpdate --sync`, not `PlugInstall`, so
  existing machines follow branch changes.

## Scripting preference

- Prefer Bash over JavaScript/TypeScript for repository scripts, including
  setup, deployment, automation, and tests. Bash is more broadly available;
  do not introduce a JS runtime dependency merely for scripting convenience.
- Keep scripts portable across macOS and Linux: target Bash 3.2 where practical
  and avoid GNU-only utilities/options unless bootstrap installs them.
- Use `jq` for JSON parsing, generation, transformation, and assertions, not
  Node/JavaScript snippets. Bootstrap required tools through `init.sh`.
- Use another language only when Bash is genuinely unsuitable or an upstream
  API requires it. Keep exceptions small and explain why they are needed;
  an existing Node dependency is not by itself a reason to choose JavaScript.

## Portable Pi

`./init.sh` sets up both Pi and Neovim. `./init.sh --pi` sets up only Pi;
keep that fast path so launching Pi does not run Neovim/tool updates.

`./pi.sh` installs/deploys via `./init.sh --pi` and launches Pi without nvim
prerequisites. Sources live under `pi/`; see `pi/README.md`. Edit defaults in
`pi/agent/`, never the deployed state under `~/.pi/agent`. Setup installs global Pi only
if missing; existing Pi versions update independently. This repo owns custom
configuration and plugin pins, so ordinary `pi` uses this repository's defaults.
Claude skills/commands are bundled under `claude/`; `claude/setup.sh` seeds
missing entries into `~/.claude` through `init.sh --pi`, never overwriting existing
skills or commands. Pi also discovers trusted project `.claude/skills`.
Keep credentials and sessions out of git. All future Pi config must also deploy via `init.sh`.

## Debugging

1. Rerun `./init.sh` first; most breakage is drift it already fixes.
2. `:checkhealth` (or a specific one, e.g. `:checkhealth nvim-treesitter`),
   then `:messages` for startup errors, `:CocInfo` / `:CocOpenLog` for coc.
3. Reproduce headlessly, e.g. `nvim --headless file.go "+lua ..." +qall`,
   so fixes can be verified from a script. `nvim -V3log` traces sourcing.

## References

- Neovim docs (same as `:help`): https://neovim.io/doc/user/
- Nvim Lua guide: https://neovim.io/doc/user/lua-guide.html
- Lua 5.1 manual (LuaJIT-compatible): https://www.lua.org/manual/5.1/
- Plugins: https://github.com/neoclide/coc.nvim/wiki and https://github.com/nvim-treesitter/nvim-treesitter (main README)

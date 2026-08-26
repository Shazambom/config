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

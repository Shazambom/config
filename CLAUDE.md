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

## Configuration

- Minimize config. Choose the simplest safe, correct design. No speculative settings or abstractions.
- Enabling or disabling an existing capability should require changing one variable in one authoritative place, not editing several files. Keep routine configuration changes quick and localized. Tests should cover both states without needing rewrites whenever the selected value changes.
- Configuration is the source of truth for its current values. Document what a setting does and how to use it, not its current value or enabled/disabled status. Changing a value should not require documentation updates.
- Keep defaults and tuning values in code constants. Moving them to env vars requires a concrete operational need and explicit human approval, never an AI decision.
- Env vars are only for credentials, service URLs, and necessary infrastructure or algorithm tuning, such as worker counts, cache limits, and TTLs. No product feature switches or business behavior.
- DB config holds only required business settings. Feature switches require a business need for behavior to differ by location.
- Look for a suitable existing home for config before proposing a new table. A new setting does not justify a new table.
- Check related settings before adding config. Two booleans mean four states. Discuss invalid combinations, prerequisites, and opportunities to combine settings with the user before implementing.

## Scripting preference

- Never hard-code machine-specific absolute paths, including in tests and temporary
  debug scripts. Use relative paths; when an absolute path is required, resolve it
  from the script/repository location, `$HOME`, or the system temporary directory.
  Discover installed executables instead of embedding a user's installation path.
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

## Implementation discipline

- Agree on the MVP, non-goals, and acceptable losses before designing. Ask about
  consequential tradeoffs early. Expand scope only at the user's discretion.
- Start with one meaningful failing end-to-end test of the user's goal. A
  component passing is not proof that the full input-to-output path works.
- Follow RED-GREEN-REFACTOR. Make the smallest fix, rerun its failing test, then
  related regressions. Run broad suites at integration and final checkpoints,
  not after every small edit.
- Verify critical API contracts and lifecycle ordering in the actual installed
  runtime. Trace where input or state disappears before adding more machinery.
- When progress stalls or several approaches fail, research online. Search the
  symptom, underlying mechanism, and broader problem. Treat results as leads to
  verify, not authority or permission to change the goal. Never search private
  code, secrets, customer data, or internal URLs.
- Check the observation method before blaming the product. Test fixtures, paths,
  permissions, and source-versus-deployed artifact selection can be wrong too.
- Test safety and compatibility together, including failure paths. Protection
  must not silently discard the caller's task or make ordinary usage unusable.
- Use independent review to challenge passing tests. Distinguish runtime proof,
  source-based reasoning, and unverified behavior in reports. Passing the known
  acceptance cases is not a claim that no bugs remain.

## Feature lessons

Before planning, implementing, debugging, or reviewing a feature, read its relevant
lesson records below and any linked feature documentation. Use them to identify prior
failure modes and necessary tests, then verify their assumptions against the
current code and runtime. Do not treat historical conclusions as authority.

After every implementation, including fixes and refactors, check whether anything
went wrong or revealed a reusable lesson. If so, create or update
`docs/lessons/<feature>.md` before the final handoff and add its link to this index.
Use one record per feature, not a new file per attempt. Do not manufacture lessons
or create empty records for uneventful work.

Keep records concise and specific:
- What failed or surprised us, and the observed cause.
- The decision or correction and any accepted tradeoff.
- What the next agent should do differently.
- Relevant source paths, regression tests, and how to verify the behavior.
- Remaining uncertainty or platform limits, clearly distinguished from proof.

Prefer durable repository references over temporary logs alone. Do not copy
secrets, private transcripts, or customer data into lesson records. Update or
retire disproven advice rather than accumulating contradictions. Keep general
rules here and feature details in the linked record.

Feature index:
- [Pi Command shortcuts](docs/lessons/pi-command-shortcuts.md): fullscreen
  selection, iTerm2/tmux key routing, clipboard isolation, and session-local maps.
- [Pi session lifecycle](docs/lessons/pi-session-lifecycle.md): saved-session
  ownership, terminal loss, worker shutdown, startup replay, failure handling,
  and isolated deployment verification.

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

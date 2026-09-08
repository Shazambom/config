# Portable Pi

Run `/path/to/config/init.sh --pi` to deploy this repo's defaults to the
standard `~/.pi/agent` directory and install global Pi if it is missing.
Existing Pi installations are left alone and can update independently.
Then run `pi` from any project directory.
Rerun setup after changing repository defaults. Restart Pi or use `/reload`
to pick up deployed extensions.

Without npm, setup bootstraps Node and installs Pi under `~/.local`; add
`~/.local/bin` to your PATH as reported by setup. You can also use the launcher:

```bash
/path/to/config/pi.sh
```

This runs `init.sh --pi`, installs the lockfile-pinned Pi locally if needed,
deploys the repository defaults, and starts your existing Pi **in your current
directory**. The lockfile-pinned local Pi remains a fallback and test runtime;
it does not constrain your global Pi version.
No preinstalled Node.js, npm, jq, Pi, Neovim, Go, or Claude executable is needed.
The Bash bootstrap downloads private, pinned Node.js 22.23.2 (including npm)
and jq 1.8.1, verifies their repository-pinned SHA-256 checksums, then installs
Pi and all npm dependencies.
Later launches reuse the installed runtime and dependencies.

Supported: macOS and modern glibc Linux, arm64/x64 (not Alpine/musl or native
Windows). The initial download needs internet and standard OS utilities: Bash,
tar/gzip, curl or wget, and shasum or sha256sum. No sudo or shell-profile edits.

On first launch, run `/login` and choose OpenAI Codex (or supply provider API
keys and select another model). Existing standard Pi credentials and sessions
are preserved and reused. Defaults match the current setup: OpenAI Codex,
`gpt-6-astra`, medium thinking, dark theme. Model availability depends on your
provider/account; override with `--provider` / `--model` if needed.

```bash
/path/to/config/pi.sh -c                   # Continue last session
/path/to/config/pi.sh --model MODEL        # Override model for this run
./init.sh --pi                             # Install/deploy without launching
./init.sh                                  # Set up everything: Pi, then Neovim
```

## Claude commands and skills

Sources stay in `~/.claude`; nothing is modified or copied into git.

| Claude source | Pi invocation |
|---|---|
| `~/.claude/commands/bro.md` | `/bro` |
| `~/.claude/commands/prove-it.md` | `/prove-it` |
| `~/.claude/commands/blast-radius.md` | `/blast-radius` |
| `~/.claude/skills/how/SKILL.md` | `/skill:how question here` |
| Any other valid `SKILL.md` in that tree | `/skill:<name> arguments` |

Skills also appear in the model's available-skills list. References, assets,
and scripts retain their original paths. All 3 commands and 11 current skills
were verified through Pi's real RPC command inventory.

Commands are discovered recursively at launch, including symlinked folders;
reported discovery errors abort setup before deployment. Pi uses the filename,
not a Claude folder namespace:
`commands/team/review.md` becomes `/review`. Duplicate filenames fail setup
rather than silently hiding a command. Avoid names reserved by Pi built-ins.
Native templates support `$ARGUMENTS`, `$1`, etc.; arguments only appear where
the template uses placeholders. Skill arguments are appended natively.

Use `/reload` after editing existing sources or adding skills. Restart the
launcher after adding/removing command files to rebuild the file list.
Missing Claude directories are fine: Pi starts without those resources.

**Importing instructions is not emulating Claude Code.** Claude-specific
frontmatter, shell preprocessing, hooks, permissions, and MCP integrations are
not emulated. `how` can map scout/oracle/reviewer intent to the installed Pi
subagent API; `why` can use public web research, but private MCP sources remain
unavailable. `arena`'s parallel code writers are deliberately not enabled.
Multi-model workflows still require those models and their authentication;
same-model children are not substitutes for independent model families.
Review skills before running them: they can direct shell execution.

## Installed extensions

Installed only through the lockfile; Pi loads local package paths, not floating
`pi install` entries. No additional global npm installation is needed.

### Human code review — `pi-diff-review@0.1.26`

Terminal-native diffs and line/range annotations. Restart `pi.sh` after adding
this package to an existing session; then use:

```text
/diff HEAD                 # Staged + unstaged tracked changes against HEAD
/diff                      # Unstaged tracked changes only
/diff --cached             # Staged changes only
/view path/to/new-file.go  # Inspect a new/untracked file
```

For production-focused review, pass Git exclusion pathspecs. For example:

```text
/diff HEAD -- . ':(exclude,glob)**/*_test.go' ':(exclude,glob)**/*.test.*' ':(exclude,glob)**/*.spec.*' ':(exclude,glob)**/tests/**' ':(exclude,glob)**/__tests__/**'
```

These exclusions are per invocation, **not an automatic default**. Adjust for
your project's test/fixture layout; `/diff HEAD` shows all tracked changes again.
Keep runtime config, migrations, scripts, and dependency changes in review.
Git diffs omit untracked files: check `git status --short` and use `/view` for new
files. Do not stage files just to expose them. `HEAD` requires an initial commit;
use `/view` in a new repository. Branch ranges show committed changes only.

Keys: `v` switches unified/split view, `n/p` moves between hunks, `c` comments,
`J/K` extends a selection, `Enter` **sends comments to Pi** (which can trigger
further edits), and `q` exits. `?` requests an optional AI explanation using your
selected model/account; it sends the excerpt and consumes quota. Merely viewing
a diff needs no model call. `/diff --turn-based` offers experimental reviewed-hunk
tracking with `M`.

Instructions ask Pi to offer a checkpoint after substantial production changes,
not pop up after every edit. This is post-change review, not a permission gate.
Comments persist in Pi sessions and a Git-local `pi-diff-review-comments.json`
store; outside Git the fallback is `.pi-diff-review-comments.json` in the working
directory. Treat these as private review data, not files to commit.

### Subagents — `pi-subagents@0.66.0`

- `scout`: local code exploration.
- `reviewer`: independent code review, **no fixes**; supply a diff/file path.
- `oracle`: architectural second opinion.
- `researcher`: cited public web research; only the web extension is loaded.

All inherit the selected model, start with fresh context, and cannot delegate.
Local roles have only `read`, `grep`, `find`, `ls`; researcher has `read` and the
four web tools. The parent remains the only code writer. Delegate on explicit
request (including skills requesting agents), not automatically on every task.

Defaults: foreground, at most three concurrent children, three spawns per run,
twelve per session, ten-minute run timeout, one-minute tool timeout. Watchdogs,
bundled agents/prompts, schedules, missions, and cross-session bridging are off.
Artifacts stay with private session state rather than the working tree.

Examples inside Pi:

```text
/run scout Map the authentication flow; report relevant files and risks.
/run reviewer Review the changes described in /tmp/change.diff. Do not edit.
/run researcher Find official documentation for Node's permission model.
Use two foreground subagents: scout to map this module, reviewer to assess risks.
/subagents-fleet
/subagents-doctor
```

For programmatic parallel delegation, the pinned release uses `workflowScript`
with `runs.all`, not the old top-level `tasks` array. The bundled
`/skill:pi-subagents` documents the API; our global instructions narrow its more
permissive defaults. Trusted project agent files can override these roles.

### Web — `pi-web-access@0.28.0`

Provides `web_search`, `fetch_content`, `get_search_content`, and `source_check`.
Ask Pi to search in natural language; `/search` browses previously stored results.

- Search selects **OpenAI**, preferring the isolated Codex login; it may fall
  back to an available OpenAI API key, not to unrelated search providers.
  It consumes provider quota; account/model web-search availability can vary.
- Ordinary pages fetch directly over HTTP, with no hosted fetch-provider
  fallbacks. PDFs extract locally using bundled `unpdf` (10 MB, 40 pages).
- Browser-cookie extraction, YouTube/local-video analysis, images, GitHub
  cloning, browser curator, automatic summaries, and remote curator access
  are disabled. Launcher also clears the two browser-cookie opt-in flags.
- Inline content defaults to 12,000 characters; request focused excerpts.
  No browser, Python, ffmpeg, yt-dlp, or extra search-provider key is required
  for this selected feature set. JS-only/blocked sites may fail; report gaps.

**These are conservative defaults, not a security sandbox.** The packages run
with your user permissions. Tool arguments or trusted project config can
change routing/limits; prompt instructions prohibit bypassing these defaults
without approval. Search queries leave the machine, fetched sites see requests,
and artifacts can contain sensitive data. Do not search private code/secrets or
upload local files. Neither extension provides Claude's permission system.

## Source of truth and portability

- `pi/agent/settings.json`: versioned defaults; `setup.sh` adds command paths.
  Installation, discovery, and deployment use Bash; jq handles JSON.
- `pi/agent/AGENTS.md`: cross-harness/delegation/research instructions.
- `pi/agent/agents/*.md`: versioned role definitions.
- `pi/agent/extensions/subagent/config.json`: delegation limits/defaults.
- `pi/agent/web-search.json`: web routing/privacy defaults.
  All resources under `pi/agent/` deploy through `init.sh --pi`.
- `pi/runtime.sh`, `pi/jq.sh`: Bash bootstraps with pinned downloads/checksums;
  `pi/bootstrap.sh` shares download, verification, and staging operations.
- `pi/package.json` + `pi/package-lock.json`: pinned Pi/dependency graph.
- `~/.local/share/config-pi/runtime`: private Node/npm/jq, never installed globally.
  Set `CONFIG_PI_RUNTIME_DIR` to an absolute directory to relocate the runtime.
- `~/.pi/agent`: deployed settings, private auth, sessions, shared by global
  `pi` and `pi.sh`. Setup replaces repository-owned configuration only.
  Set `CONFIG_PI_HOME` to an absolute directory to isolate launcher state;
  this also skips global Pi installation.
- Global Pi is installed at the latest release only if missing, and is never
  upgraded or downgraded by setup. Update it normally with `pi update` or npm.
  Custom plugins and the local fallback/test runtime are pinned by
  `pi/package-lock.json`.
  Trusted project Pi configuration and shared `~/.agents/skills` discovery
  still work normally; this is not a sandbox.

Edit defaults **in this repo**, then relaunch. `/settings` and saved model
changes affect the current deployment but are reset at the next setup (also
run automatically by `pi.sh`, but not by global `pi`).
Credentials and sessions are preserved. Future configuration files must also
be deployed through `init.sh`; don't hand-install into the state directory.

On a new machine, clone this repo, provision your `~/.claude/commands` and
`~/.claude/skills` through your existing private sync/backup, then run `pi.sh`
and log in. The Claude content is intentionally not bundled in this repo.
Do not commit auth files or sessions. Global Pi updates independently of this
repo. Change plugin pins and regenerate the lockfile to update custom plugins;
rerun `init.sh --pi` to install and deploy them.

## Verification (no paid model calls or credentials required)

```bash
./init.sh --pi
./pi/test-setup.sh        # Deployment failures, unusual paths, private state
./pi/test.sh              # Temporary HOME, nested template, args, skill paths
./pi/test.sh --live       # Verify this machine's original 3 commands/11 skills
./pi/test-extensions.sh  # Local scripted model: real child/tool execution
```

Test entry points and shared lifecycle helpers use Bash 3.2 and jq; they select
the bootstrapped tools themselves. The only JS exception is
`pi/tests/model-fixture.mjs`: it directly exercises upstream TypeScript APIs and
emulates OpenAI HTTP/SSE tool calls. It does not orchestrate processes or deploy
configuration. Implementing that protocol/API fixture in Bash would be brittle.

The live inventory test deliberately asserts the current counts; update it
when the expected global inventory changes. Extension tests verify plugin
config parsers, role discovery, foreground/parallel delegation, model inheritance,
actual restricted child tool inventories, evidence reads, and loopback-fetch
blocking. Authenticated OpenAI search is not exercised by these offline tests.
The installed dependency graph had zero known `npm audit --omit=dev` advisories
when checked; this and selective source review are not a security audit.

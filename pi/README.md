# Portable Pi

Run `/path/to/config/init.sh --pi` to deploy this repo's defaults to the
standard `~/.pi/agent` directory and install global Pi if it is missing.
The underlying Pi package can update independently. Setup installs an executable
wrapper at the existing `pi` command path, so plain `pi` runs this repo's `pi.sh`
from any shell. No aliases, functions, or shell startup changes are needed.
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
Later launches reuse the installed runtime and dependencies. Interactive launches
open a new tmux session when outside tmux. In iTerm2, the launcher uses native
integration (`tmux -CC`); other terminals use the standard tmux UI. Inside tmux,
the launcher uses the current pane. Print/RPC modes do not open tmux.

Supported runtime: macOS and modern glibc Linux, arm64/x64, not Alpine/musl or
native Windows. Downloads need Bash, Git, tar/gzip, curl or wget, and shasum or
sha256sum. Setup installs tmux through Homebrew on macOS or apt/dnf/pacman on
Linux if missing. Homebrew must already be available on macOS. Linux package
installation uses sudo when not root. Chromium's Linux dependencies require a
Playwright-supported Debian/Ubuntu distribution and apt. Setup downloads the
Chromium revision selected by the pinned Playwright version. It does not edit
shell profiles.

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

## Appearance

The default is `jetbrains-dark`, with charcoal panels and blue selections.
Diff additions use pale-green text and markers (`#AFF5B4`) on dark green (`#033A16`).
Deletions use `#FFDCD7` text on `#67060C`,
the deletion pair in [highlight.js's GitHub Dark palette](https://github.com/highlightjs/highlight.js/blob/main/src/styles/github-dark.css).
`pi/patches/diff-review-colors.patch` colors added and removed code with their
respective diff foregrounds instead of ordinary syntax colors, and adds explicit
`−` / `+` line markers. Box-drawing and block-element characters in source text
appear as `\uXXXX` escapes so solid glyphs cannot look like obscured string values.
This changes only the review display, not files or comment excerpts; search still
matches source text and maps matches to the escaped display. Reviewed rows use
a green (`#26442E`) overlay.
Search-match styling, comment markers, selection and reviewed-row backgrounds
still take precedence. The patch deploys through setup; restart Pi after changing
it so the diff extension loads the new renderer. For `jetbrains-dark`, this patch
sets green/red backgrounds only inside `/diff`. Scrolling tool panels use neutral
charcoal (`#1E1F22`) for pending, successful, and failed operations. Other themes
retain their own tool-background colors in the diff viewer.
The alternative `vim-darcula` theme uses the palette from `doums/darcula`, selected
by `colorscheme darcula` in `init.vim`: `#2B2B2B` editor background, `#A9B7C6`
text, orange keywords, yellow functions, green strings, and blue numbers.
The palette is bundled here so Pi-only setup does not require Neovim plugins.
Vim's separate `PaperColor_light` statusline is not used for Pi's palette.

In `vim-darcula`, tool panels share the neutral editor background; errors still
have red status text. Diff additions use green markers and deletions use gray,
without distinct line backgrounds. Pi's limited
color tokens do not reproduce Vim's per-line diff backgrounds or full syntax groups.
The terminal's base background is unchanged; use `#2B2B2B` there for a full match.
Both themes are available under `/settings` → Theme.

Select it under `/settings` → Theme after setup, or restart Pi. Edit
`pi/agent/themes/jetbrains-dark.json` and rerun `./init.sh --pi` to tune the default.
The active custom theme hot-reloads when its deployed file changes. Set the
portable default in `pi/agent/settings.json`; setup resets choices saved only
through `/settings`.

Pi uses its standard startup header. Setup removes the known repository-owned
mascot extension by checksum. A customized copy is preserved with a warning;
move that file aside if you want to disable it too.

## Claude commands and skills

`claude/skills/` and `claude/commands/` contain portable snapshots from the
original global Claude config and `~/Scheduler/.claude`. `init.sh --pi` runs
`claude/setup.sh` to install missing entries into `~/.claude` before Pi discovers
them. Existing skill directories and command files, including dangling symlinks,
are left untouched. An existing skill is skipped as a whole, not partially merged.
Setup never reads Scheduler on subsequent runs or imports its settings/credentials.
See [`claude/README.md`](../claude/README.md) for provenance and limitations.

| Claude source | Pi invocation |
|---|---|
| `~/.claude/commands/bro.md` | `/bro` |
| `~/.claude/commands/prove-it.md` | `/prove-it` |
| `~/.claude/commands/blast-radius.md` | `/blast-radius` |
| `~/.claude/skills/how/SKILL.md` | `/skill:how question here` |
| Any other valid `SKILL.md` in that tree | `/skill:<name> arguments` |

Skills also appear in the model's available-skills list. References, assets,
and scripts resolve relative to the loaded skill directory. Global Claude skills
are available to all Pi models, including Codex Astra. The `claude-skills.ts`
extension also discovers `.claude/skills` from the working directory upwards,
stopping after the nearest `.git` directory or file, or at the filesystem root.
Project discovery requires Pi project trust and respects CLI `--no-skills`.
The subagent deployment patch explicitly loads this resource-only extension in
restricted children without enabling additional tools. Same-name skills follow
Pi's first-found rule with a warning; global configured skills win over these
extension-discovered project skills. Project-only commands are not auto-discovered;
the bundled Scheduler commands become available through the global installation.

Commands are discovered recursively at launch, including symlinked folders;
reported discovery errors abort setup before deployment. Pi uses the filename,
not a Claude folder namespace:
`commands/team/review.md` becomes `/review`. Duplicate filenames fail setup
rather than silently hiding a command. Avoid names reserved by Pi built-ins.
Native templates support `$ARGUMENTS`, `$1`, etc.; arguments only appear where
the template uses placeholders. Skill arguments are appended natively.

Use `/reload` after editing existing sources or adding skills. Restart the
launcher after adding/removing command files to rebuild the file list.
Missing Claude directories are populated from the bundle during setup.

**Importing instructions is not emulating Claude Code.** Claude-specific
frontmatter, shell preprocessing, hooks, permissions, and MCP integrations are
not emulated. `how` can map scout/oracle/reviewer intent to the installed Pi
subagent API; `why` can use public web research and the configured Grafana MCP
proxy. Other private MCP sources remain unavailable unless explicitly configured. Workers can write code; give concurrent writers separate worktrees
or exclusive files. The subagent extension does not isolate worktrees for you.
Multi-model workflows still require those models and their authentication;
same-model children are not substitutes for independent model families.
Review skills before running them: they can direct shell execution.

## Design sessions

Run `/skill:design <existing plan or plan reference>` before implementation.
The skill reads the affected code and drafts `design.go` in a private session
subdirectory of a verified Git-ignored project directory. It first looks for a
suitable existing scratch directory. If none exists, it may create `.design/`
and add `/.design/` to the root `.gitignore`. It checks the actual file paths with
`git check-ignore` and verifies they are untracked; directory names are not proof.
`design.go` starts with spacious Go-shaped pseudocode in a block comment, before
the package clause. Each call captures named results, multiline calls put one
argument on each line, and blank lines separate calls, mappings, guards, and returns.
Short early-return guards show errors. Dense arrow chains and deeply nested traces
are forbidden; a callee's interactions belong in a separate named flow. Added, changed, and removed contracts follow in clear sections, using
valid Go declarations without function bodies. Compact field/signature deltas make
changes visible without comparing every existing field. No Markdown tables or fences.

Every new field or variable needs a visible origin. Named `DERIVATION` sections
show the actual predicates, transformations, construction, defaults, and consumers;
a helper signature cannot stand in for the key logic. New logic may include loops
or calculations inside the pseudocode comments. Unresolved derivations block approval.
The comment rules apply throughout: no redundant narration, change history, rationale,
or comments inside structs. Pseudocode and navigation labels stay; explanatory comments
must state behavior that the code cannot express.

Unchanged types and dependency stand-ins live separately in `support.go`, in the
same package. They help gopls type-check the proposal; syntax coloring alone does
not require them. Proposed changes must never be hidden in that file. KISS remains
explicit: use the simplest correct design, without speculative abstractions.

A design-local `go.mod` isolates the package. Every revision snapshots the whole
package under `snapshots/revision-NNN/`, with `.txt` suffixes so old Go declarations
and module files are not loaded. The agent checks syntax and types without fetching
dependencies. Those checks do not validate the flow comments, prove behavior, or
establish production compatibility.

The agent gives you `/view <path>/design.go` for every review round. `/view` opens
ignored files and collects comments; Enter queues feedback as a steering message.
You can also edit `design.go` in Neovim. The agent re-reads direct edits before
applying feedback and saves each presented revision as an immutable snapshot.
Revision comparisons with `/diff --no-index` are optional, on request.

Only an explicit instruction such as "Implement this design" authorizes code
changes to match the reviewed revision. Submitting comments or closing the review
does not. This is a skill instruction, not a tool permission sandbox. Design files
stay ignored and are never staged or committed. The skill may add a workspace
ignore rule before approval, but leaves it unstaged and reports the change.
Bare `/diff` omits ignored files; `/view` is the default design review command.
Pi sessions and the existing review-comment cache can still retain excerpts.

Sources live in `claude/skills/design/` and deploy through `init.sh --pi`.
Setup preserves customized global skills. It archives exact known Markdown,
plain-text, and prior Go bundles outside discovery before seeding the updated skill.
`bash claude/test-design-go.sh` checks the example with Go and gopls when installed.

## Installed extensions

`init.sh --pi` installs npm dependencies from the lockfile and fetches upstream
archives pinned by commit and SHA-256 in `pi/upstream.json`. Only the six selected
extensions are extracted. No upstream skills are installed. Pi loads local
paths, not floating `pi install` entries. Extension TypeScript is upstream code;
installation, deployment, and test orchestration stay in Bash.

### Subscription quotas

`init.sh --pi` installs `@latentminds/pi-quotas@0.5.0` from the npm lockfile.
Restart Pi or run `/reload`, then use:

```text
/usage              # Anthropic and OpenAI Codex subscription quotas
/quotas             # Same dashboard
/anthropic:quotas    # Anthropic only, including authentication errors
/codex:quotas        # Codex only, including authentication errors
```

The dashboard shows remaining percentages and reset times reported by the
providers. Press `r` to refresh or `q` / Escape to close. Cached results last
five minutes for Anthropic and one minute for Codex; `r` bypasses the cache.
Missing subscriptions and authentication errors remain visible. These are
account-wide provider quotas, not this conversation's token count or billing.

`pi/overrides/quotas.ts` owns the dashboard lifecycle and uses upstream's exported
`QuotasComponent` and fetch helpers. It does not import the private command helper.
The package's footer, warning notifications, token-history scanner, settings
command, and other provider commands are not enabled. Nothing polls in the
background. Commands refuse print, JSON, RPC, subagent, and memory-worker
invocations before reading credentials or fetching quotas. The wrapper registers
no model tools or session hooks and does not read project quota settings.

On explicit invocation, the extension resolves credentials through Pi's model
registry and reads stored OAuth metadata from the active agent directory's
`auth.json`. Codex falls back to `~/.codex/auth.json` for an account ID if Pi's
entry lacks one. Credentials go only to the respective provider's HTTPS quota
endpoint, `api.anthropic.com/api/oauth/usage` or
`chatgpt.com/backend-api/wham/usage`. Pi may refresh expired OAuth credentials
through its normal auth flow. No model completion is requested. Direct Anthropic
API keys cannot report subscription usage; use `/login` with a subscription.

`pi/patches/quotas.patch` adapts the imported modules to the
`@earendil-works` namespace, truncates the dashboard's help line on narrow
terminals, and suppresses raw HTTP bodies and unexpected error
text. HTTP failures retain their status code. Setup reapplies the patch from a
preserved upstream source copy. TypeScript is needed for the upstream extension
API; installation and test orchestration use Bash.

Run `./pi/test-quotas.sh` for isolated deployment and mocked Anthropic/Codex
checks. An optional Pi package directory tests another installed runtime, for
example `./pi/test-quotas.sh /path/to/global/node_modules/@earendil-works/pi-coding-agent`.
The fixtures exercise both the SDK extension loader and `dist/bundle/cli.js`,
using the real auth registry with fake credentials. They check both aliases,
refresh, error redaction, noninteractive guards, dashboard rendering, and closing
while a request is pending. The bundled CLI test invokes a fixture command with
an in-memory UI, not a live terminal. No paid calls or real credentials are used.
Live account access and OAuth refresh are not tested.
Upstream 0.5.0's provider parsing remains unchanged; Anthropic 429 handling and
additional scoped quota windows from open upstream PRs are not included.

### Human code review — `pi-diff-review@0.1.26`

Terminal-native diffs and line/range annotations. Restart `pi.sh` after adding
this package to an existing session; then use:

```text
/diff                      # Branch + working-tree changes, including untracked files
/diff HEAD                 # Staged + unstaged tracked changes against HEAD
/diff h                    # Shortcut for /diff HEAD, also excludes untracked files
/diff --                   # Unstaged tracked changes only
/diff --cached             # Staged changes only
/diff --all-files          # Include tests and generated files
/view path/to/new-file.go  # Inspect a new/untracked file
/view --all-files path     # Include tests and generated files
```

Bare `/diff` shows the net tracked changes against the merge base of `main` and
`HEAD`, plus non-ignored untracked files as additions. It covers the whole repo,
even when Pi starts in a subdirectory. It never stages files or changes the index.
It uses `origin/main` if local `main` is absent, then falls back to `HEAD` if
neither exists. The title identifies the baseline. Without commits, it compares
against an empty tree. No fetch runs automatically; base refs are local snapshots.
Changes that cancel out relative to the baseline do not appear separately.

Untracked binaries and empty files appear as file entries, not text hunks.
Ignored files stay excluded. The UI cannot safely annotate filenames containing
control characters; those untracked paths produce an error rather than an
incorrect review. The combined diff has a 128 MiB limit. Submodule contents are
not expanded; review inside the submodule for its file changes.

Both commands hide conventional test files and generated output by default,
including when a hidden file is explicitly requested. A notice reports the number
of files hidden by category. This filters the review only: files stay tracked,
unchanged, and available to builds and tests.

Put `--all-files` immediately after the command to disable this filtering:

```text
/diff --all-files HEAD
/diff --all-files --cached
/view --all-files path/to/example_test.go
```

Test detection uses filename and directory conventions across languages. It is
heuristic, not a test-runner invocation; tests embedded in production files stay
visible. Generated detection recognizes generator comment headers, including Go's
`// Code generated … DO NOT EDIT.` convention used by sqlc, mockery, and Wire.
A generator directive such as `//go:generate` does not mark a file as generated.
SQL queries, schemas, Wire injector definitions, and generator configuration remain
visible unless separately classified as tests or explicitly marked generated.

The filter honors Git's `linguist-generated` attribute. Set it for project-specific
outputs, or unset it to override generated-code detection for a hand-written file.
It does not write `.gitattributes` or `.gitignore` for you. Generated detection uses
the reviewed version of a file, not an unrelated working-tree version. Files stay
visible when bounded reads cannot establish their classification, including pure
renames or mode-only diffs without recoverable headers. For example:

```gitattributes
custom-output/** linguist-generated
custom-output/manual.go -linguist-generated
```

After the leading review option, explicit Git arguments retain their meaning and
omit untracked files. Use bare `/diff` or `/view` for new files; do not stage files
just to expose them. Explicit `HEAD` requires an initial commit. Branch ranges such
as `/diff main...HEAD` show committed changes only. Use `--all-files` for a complete
review, including runtime changes that a naming heuristic might misclassify.

Keys: `v` switches unified/split view, `n/p` moves between hunks, `c` comments,
`J/K` extends a selection, `Enter` **sends comments to Pi** (which can trigger
further edits), and `q` exits. Submitted `/diff` and `/view` comments enter Pi's
steering queue if the agent is busy, or start a turn if it is idle. `?` requests an optional AI explanation using your
selected model/account; it sends the excerpt and consumes quota. Merely viewing
a diff needs no model call. `/diff --turn-based` offers experimental reviewed-hunk
tracking with `M`, using the complete diff when no Git arguments are supplied.

`pi/overrides/diff-source.ts` adapts the pinned package's TypeScript source API.
`init.sh --pi` preserves the upstream module and deploys this adapter into the
local package. Setup checks the upstream SHA-256 and refuses an incompatible
update. The review filter sits alongside the source and UI adapters; ordinary
Git argument handling remains upstream.
TypeScript is used here because the package imports this module directly.

`pi/overrides/diff-ui.ts` and `pi/patches/diff-review-ui.patch` keep `/diff` and
`/view` in a full-viewport overlay while the agent streams. In Pi's regular
terminal mode, the adapter temporarily replaces the TUI instance's base render
method with blank rows so offscreen transcript updates cannot force screen clears.
The agent and its UI state keep updating. Closing the review restores the method
and paints the current transcript. Fullscreen Pi uses its native overlay renderer.
Setup deploys these changes only into the pinned local diff package, not global Pi.

This adapter is tested with Pi 0.85.1 and diff-review 0.1.26. Unknown regular-mode
renderers get a warning and an ordinary overlay, which may still repaint while
streaming. Restart Pi after deployment. Keyboard navigation remains unchanged;
mouse-wheel navigation is not added. In regular Pi mode, tmux's wheel can enter
copy mode and scroll terminal history rather than the diff.

Instructions ask Pi to offer a checkpoint after substantial production changes,
not pop up after every edit. This is post-change review, not a permission gate.
Comments persist in Pi sessions and a Git-local `pi-diff-review-comments.json`
store; outside Git the fallback is `.pi-diff-review-comments.json` in the working
directory. Treat these as private review data, not files to commit.

### Interactive subagents

[pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents)
runs async Pi sessions in tmux panes. Results arrive as notifications; agents
can ask the parent questions and resume by name. Worker delegation is available.

| Role | Tools and purpose |
|---|---|
| scout | Read-only code exploration |
| reviewer | Read-only review; supply a diff or its path |
| oracle | Read-only architecture and planning advice |
| researcher | Public web research, read, and upstream safe_bash |
| worker | Read/write/edit/bash/web tools; can spawn scout and researcher |

Profiles start fresh sessions linked to the parent, append their role prompt,
and exit automatically when done. They use the configured default model unless
the parent passes a `model` override. Instructions ask the parent to pass its
current provider/model. Project `.pi/agents/*.md` overrides global roles.

```text
/subagent scout Map the authentication flow.
/subagent reviewer Review /tmp/change.diff. Do not edit.
/subagent worker Implement the assigned change and run its tests.
```

The model uses `subagents_list`, `subagent`, and `subagent_message`. Children use
`ask_question`; the parent replies with `subagent_message`. Independent tool
calls can launch in parallel. There is no workflowScript API or installed
subagent skill. Workers need exclusive files or separate worktrees. They do
not get automatic Git isolation or a filesystem security sandbox.

Plain `pi` uses the auto-tmux `pi.sh` launcher. Interactive launches outside
tmux create a session; launches inside tmux reuse the current pane. Print/RPC,
help, version, and model-listing invocations bypass tmux. iTerm2 uses native
integration when `TERM_PROGRAM=iTerm.app`; existing tmux panes are not converted.
In standard tmux, `Ctrl+b d` detaches and `tmux attach` returns.
`pi/patches/interactive-subagents.patch` makes spawn and resume use the parent's
Node executable and Pi entry point, independent of a new pane's shell PATH.

### iTerm2 selection and tmux integration

Launch `pi` from a fresh iTerm2 tab outside tmux. The launcher starts `tmux -CC`:
iTerm2 opens a native tab and automatically buries the original control tab.
A short-lived helper captures the source tab before launch, identifies the new
native tab by its tmux connection, and moves it to the original position. The
control connection stays alive but out of the way.
Native scrollback and text selection work normally: drag to select, press `Cmd+C`
to copy, and `Cmd+V` to paste. No Option modifier is needed.

On macOS, `init.sh --pi` runs `iterm2/setup.sh` to manage four iTerm2 preferences:
`OpenTmuxWindowsIn=2`, `AutoHideTmuxClientSession=true`, `CopySelection=false`,
and `EnableAPIServer=true`. These are application-wide preferences, not limited
to Pi. Ordinary tab ordering and other preferences are left alone. Linux,
isolated `CONFIG_PI_HOME` deployments, and externally managed iTerm2 preference
folders skip preference changes.

The helper uses iTerm2's supported Python API, so setup installs pinned dependencies
from `iterm2/requirements.txt` in `~/.config/portable-pi/iterm2-venv`, using an
available Python 3. This is the Python exception to the repository's Bash preference.
No Python packages are installed globally. iTerm2's API can access terminal data;
this helper reads layout/session metadata only and uses normal AppleScript authorization.
It does not read terminal output, store API credentials, or bypass consent prompts.

If the running app has not started its API server, toggle **Settings > General >
Magic > Enable Python API** off and on. This activates the saved setting live;
no restart is needed. The launcher falls back to native placement with a warning
if the helper is unavailable. Split source tabs, concurrent launches in one window,
or changed tab layouts are left alone rather than moving an uncertain target.
The helper never moves tabs across windows and exits after at most 20 seconds.

Use **Shell > tmux > Detach**
to leave the session running. Reconnect from a normal iTerm2 tab with
`tmux -CC attach -t <session>`; `tmux list-sessions` lists session names. Closing
an integrated pane/tab can kill its tmux pane/window, so use Detach to preserve work.
A `/reload` or a new Pi launch inside an existing conventional tmux pane does not
switch that pane to native integration. Other terminals retain standard tmux.

See [iTerm2's integration documentation](https://iterm2.com/documentation-tmux-integration.html).
`bash pi/test-command.sh` checks launcher routing with real PTYs and a stub tmux.
`bash iterm2/test.sh` checks preference writes and isolation, and
`python3 iterm2/test_reorder.py` checks reorder guards with an offline API fixture.

For a live debug environment, run `bash iterm2/test-live.sh`. It creates an isolated
seven-tab iTerm2 window, launches the real launcher/helper with a fake Pi executable
from tab 4, and checks native tab order and unchanged existing windows. It uses a
private tmux server, makes no model calls, and cleans up its own window and files.
Use `--position 1` or `--position 7` for edge positions. `--keep` leaves the test
window and printed fixture directory/socket available for inspection. The live test
requires API access and intentionally opens a temporary test window; it does not
validate clipboard contents.

### Standard tmux scrolling

`init.sh --pi` deploys `tmux/tmux.conf` to `~/.config/portable-pi/tmux.conf`
and adds one `source-file` line to `~/.tmux.conf`, preserving existing contents.
Mouse and trackpad scrolling are enabled by default. Setup applies the defaults
immediately when run inside tmux; otherwise new tmux servers load them at startup.
Custom `CONFIG_PI_HOME` deployments skip this user-wide configuration.

Scroll upward over a pane to enter tmux copy mode. Press `q` to return to Pi.
The keyboard alternative is `Ctrl+b`, then `[`, followed by arrows or Page Up/Down
(`Fn+↑/↓` on Mac). Terminal scrollback outside tmux is separate from pane history.
Mouse mode also lets tmux handle pane selection and text selection; native terminal
selection may require the terminal's mouse-bypass modifier.

Verify deployment without changing your tmux server with `bash tmux/test.sh`.

### Browser

[Browser](https://github.com/amosblomqvist/pi-config/tree/main/extensions/browser)
uses Playwright Chromium. `/browser on` enables navigation, JS evaluation,
console/network inspection, form interaction, and screenshots. `/browser off`
closes Chromium and disables the tools. It starts off for new sessions.

The launcher stores the browser profile under `$PI_CODING_AGENT_DIR/browser-profile`.
Plain Pi uses upstream's `~/.pi/agent/extensions/browser/.profile` default.
Set `PI_BROWSER_PROFILE` to choose a shared or disposable profile. These profiles
can contain cookies and credentials. Network header output can expose secrets.

### Observational memory

[pi-observational-memory](https://github.com/amosblomqvist/pi-observational-memory)
starts enabled for sessions without a saved on/off choice. Background observers,
consolidation, and compaction run automatically. `/om off` disables memory for
the session; `/om on` re-enables it. Saved choices survive restart and reload.
`/om:status`, `/om:compact`, and `/om:consolidate` inspect or trigger work.

`pi/agent/settings.json` sets `observational-memory.enabled` to `true`.
`pi/patches/observational-memory.patch` adds this startup fallback to the pinned
extension while preserving saved session choices. TypeScript is required by the
upstream extension API. Setup applies the patch through `init.sh --pi`.

Both observer and consolidator use `openai-codex/gpt-5.6-sol` with medium thinking,
configured under `observational-memory.models` in `pi/agent/settings.json`.
Changing the main default model or using `/model` does not change memory's models. Both roles use
the normal Pi credentials and consume model quota when enabled.

Long-context defaults deploy through `init.sh --pi`:

- `pi/agent/models.json` overrides Codex `gpt-6-astra` to 872,000 tokens and
  direct Anthropic `claude-fable-5` / `claude-fable-5-1` to 1,000,000 tokens.
  Unknown model IDs are ignored; other providers are unchanged. This file is
  repository-owned, so edit it here rather than the deployed copy.
- OM compacts Codex Astra at 350,000 tokens. Other models, including Fable, retain
  the 700,000-token threshold. The `compactAtContextTokensByModel` map in
  `observational-memory` uses exact `provider/model-id` keys. Model switching
  updates the trigger and `/om:status` threshold. All retain approximately 40,000
  recent raw tokens; model context windows and Pi fallback settings are unchanged.
- Pi fallback compaction reserves 128,000 tokens and retains 40,000 recent tokens.
  It can trigger earlier when switching to a smaller-context model. Models with
  windows at or below 128,000 need a smaller reserve in project settings.
- Other memory thresholds and observer concurrency retain upstream defaults.

These are client-side limits, not proof that an account or endpoint accepts
requests this large. Long sessions consume more quota and may increase latency;
Astra's published API pricing increases above 272,000 input tokens. No live
near-limit request was used to validate these defaults. Restart Pi to load all
settings together; `/model` alone reloads model overrides.

Memory files live in `<project>/.memory/<sessionId>/`, including transient worker
handoffs. Workers also record ordinary Pi sessions. Memory can contain private
conversation data; keep `.memory/` out of commits in every project where used.
Topic files do not roll back with `/tree` even though the observation ledger does.

### Missing credentials

Interactive setup prompts for missing values after the normal credential imports.
Each prompt names the exact variable, gives a short description and links to the
provider. Input is hidden, including URLs and IDs; Enter skips a value.

| Variable | Where to find it |
|---|---|
| `GOOGLE_SEARCH_API_KEY` | [Google Cloud API credentials](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CSE_ID` | [Programmable Search control panel](https://programmablesearchengine.google.com/controlpanel/all) |
| `GRAFANA_URL` | [Grafana Cloud organization/stacks](https://grafana.com/profile/org) |
| `GRAFANA_SERVICE_ACCOUNT_TOKEN` | [Grafana service accounts](https://grafana.com/docs/grafana/latest/administration/service-accounts/) |

The prompt helper checks the environment and private Pi config, and reads literal
Google assignments from `.zshrc` to recover partially configured search credentials.
It never sources or edits `.zshrc`. Existing values are not replaced; a complete
pair is required before saving new values. Saved files are mode 600 in the private
Pi agent directory, never this repository. Enter-skipped values are asked again on
the next interactive setup. New Grafana configs use a pinned Docker image digest;
imported configs retain their image. Custom HTTP/command Grafana configurations and
symlinked credential files are left alone rather than guessing their requirements.

Use `CONFIG_PI_NO_PROMPT=1 ./init.sh --pi` to suppress prompts. Setup without terminal
stdin/stderr never prompts, and `pi.sh` suppresses prompts for print/RPC/help/version
and model-listing invocations. Existing noninteractive imports still run. Pi model
sign-in remains `/login`; OAuth is not replaced with a raw credential prompt.

### Grafana MCP

Setup installs the pinned `pi-mcp-adapter` dependency and loads
`pi/overrides/grafana-mcp.ts`. This small TypeScript wrapper uses the adapter's
extension API with an isolated snapshot of `<Pi agent dir>/mcp.json`. It does not
automatically adopt project `.mcp.json` files or other hosts' servers. The default
agent dir is `~/.pi/agent`; `CONFIG_PI_HOME` relocates deployment as usual.

`pi/mcp-import.sh`, called by `init.sh --pi`, imports only the global
`mcpServers.grafana` Docker definition from `~/.claude.json` when Pi has no Grafana
entry. It never writes Claude's config. Existing Pi servers/settings are preserved,
and existing Grafana entries or a symlinked `mcp.json` are left untouched. Missing
Claude/Grafana config is allowed. The importer moves Docker `-e KEY=value` pairs
into explicit environment variables and sets `literalEnv: true`, preventing secret
values from being interpreted as adapter commands. The private file has mode 600;
credentials are never bundled in this repository. Remove only the private Grafana
entry and rerun init to reimport rotated credentials.

Docker must already be installed and running, as required by the existing Claude
configuration. Setup does not install Docker or pull/update the configured image;
Docker may pull it when the server first connects. Grafana is lazy and proxy-only,
so startup does not connect and its entire tool catalog stays out of the prompt.
MCP scripting and model sampling default off. Restricted subagents do not gain MCP
access automatically. Tools retain the imported account's permissions; this setup
does not make a writable account read-only.

Restart Pi after setup. Use `/mcp status`, `/mcp tools`, or
`/mcp reconnect grafana` to inspect/connect. The agent can call:

```text
mcp({ connect: "grafana" })
mcp({ search: "loki", server: "grafana" })
mcp({ describe: "grafana_query_loki_logs" })
```

Use the returned schema to make a tool call. The existing `/skill:grafana-logs`
provides query guidance. The wrapper intentionally uses programmatic config, so
adapter setup/write commands are limited; manage servers in the private global
file and reload Pi. Do not put credentials or cached private MCP output in Git.

Verification uses a local fake stdio server by default. An explicit live check
connects and lists Loki datasources, without querying logs or modifying Grafana:

```bash
./pi/test-mcp.sh
PI_CODING_AGENT_DIR="$HOME/.pi/agent" node pi/tests/mcp-fixture.mjs --live
```

### Prompt snippets

[Prompt snippets](https://github.com/amosblomqvist/pi-config/tree/main/extensions/prompt-snippets)
provides `/snippets` and Ctrl+R in the prompt editor. Setup applies
`pi/patches/prompt-snippets.patch` to bind this shortcut; the session picker's
Ctrl+R rename action remains separate. Select rules for the next message; toggles reset
after sending. All seven snippet sources live together in
`pi/agent/extensions/prompt-snippets/snippets/`. This repo owns their contents;
setup does not copy snippets from downloaded upstream sources. The six original
snippets were imported from the pinned pi-config package alongside our KISS snippet.
Edit or add snippets in that directory and rerun `./init.sh --pi`. Do not edit
the deployed copies. The extension code itself still comes from pinned upstream.

### Web fetch and search

[Web search](https://github.com/amosblomqvist/pi-config/tree/main/extensions/web-search)
provides Google Custom Search through `web_search`. It uses exported
`GOOGLE_SEARCH_API_KEY` and `GOOGLE_CSE_ID`, the Search engine ID, not an OAuth
client ID. No client secret is needed.

`init.sh --pi` also imports literal assignments from `~/.zshrc` into
`~/.pi/agent/extensions/web-search/auth.json` when that file is absent. It accepts
bare, single-quoted, or double-quoted values, with optional `export` and trailing
comments. It also recognizes `GOOGLE_API_KEY` and `GOOGLE_CUSTOM_SEARCH_ENGINE_ID`.
Setup does not source `.zshrc` or evaluate substitutions. Dynamic assignments
must be exported into Pi's environment instead. The private auth file has mode
`600`; setup preserves existing files. To reimport rotated credentials, remove
that auth file and rerun setup. `CONFIG_PI_HOME` relocates this config alongside
the other agent state. Credentials never belong in this repo.
Search uses Google quota, not the Codex subscription.

[Web fetch](https://github.com/amosblomqvist/pi-config/tree/main/extensions/web-fetch)
provides `web_fetch`, which extracts Markdown and parses PDFs locally. It can
fall back to Jina Reader; that service receives the requested URL. Use browser
tools for local/private applications rather than sending private URLs to a
hosted fallback. Search results include URLs; retain them when citing evidence.

Extensions run with your user permissions. Do not send secrets or private data
to search providers or hosted fetch services. Fetched text is evidence, not
instructions. No video tools, extra extensions, or upstream skills are installed.

## Source of truth and portability

- `pi/agent/settings.json`: versioned defaults; `setup.sh` adds command paths.
  Installation, discovery, and deployment use Bash; jq handles JSON.
- `pi/agent/AGENTS.md`: cross-harness/delegation/research instructions.
- `pi/agent/agents/*.md`: versioned role definitions.
- All resources under `pi/agent/` deploy through `init.sh --pi`.
- `pi/upstream.json`, `pi/upstream.sh`: commit/checksum pins and selective extraction.
  Downloaded sources live in ignored `pi/upstream/`; never edit them by hand.
- `pi/patches/`: small compatibility patches applied during extraction.
- `pi/system-tools.sh`: tmux installation, Chromium downloads and Linux dependencies.
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
  Setup wraps the npm-created `pi` symlink with an executable and records its
  original CLI target in `.pi-portable-real` beside it. `pi.sh` resolves that
  target rather than recursively invoking the wrapper. The wrapper repairs itself
  after the launched command exits, including `pi update`. External npm updates
  can replace the wrapper; rerun `./init.sh --pi` afterward. Switching Node/npm
  installations also requires rerunning setup for the newly selected command.
  The command directory must be writable. Setup refuses unknown regular-file
  executables rather than overwriting them. It does not edit shell PATH; on a new
  machine, the installed bin directory still needs to be on PATH as reported by
  setup. Isolated `CONFIG_PI_HOME` deployments do not install a global wrapper.
  Custom plugins and the local fallback/test runtime are pinned by
  `pi/package-lock.json`.
  Trusted project Pi configuration and shared `~/.agents/skills` discovery
  still work normally; this is not a sandbox.

Edit defaults **in this repo**, then relaunch. `/settings` and saved model
changes affect the current deployment but are reset at the next setup (also
run automatically by both `pi.sh` and the installed `pi` wrapper).
Credentials and sessions are preserved. Future configuration files must also
be deployed through `init.sh`; don't hand-install into the state directory.

On a new machine, clone this repo and run `pi.sh` to seed the bundled Claude
commands and skills. Restore any additional private resources separately. Run `pi.sh`
and log in. The Claude content is intentionally not bundled in this repo.
Do not commit auth files or sessions. Global Pi updates independently of this
repo. Change npm pins and regenerate the lockfile to update npm dependencies.
Update commit/checksum pins in `pi/upstream.json` for upstream extensions, review
the selected source and patches, then rerun `init.sh --pi`. Setup removes only
unchanged, repository-owned legacy web/subagent config files. Private state and
modified legacy files are preserved.

## Verification (no paid model calls or credentials required)

```bash
./init.sh --pi
bash ./pi/test-command.sh # Executable wrapper and real-TTY launch routing
./pi/test-setup.sh        # Deployment failures, unusual paths, private state
./pi/test-mcp.sh          # Private Grafana import and fake stdio MCP round-trip
./pi/test-credential-prompts.sh # Real-terminal hidden input, partial config and skips
./pi/test-diff.sh         # Complete diff, explicit args, parser, index preservation
./pi/test-diff-render.sh  # Isolated tmux, synthetic streaming, overlays and resize
DIFF_TEST_FULLSCREEN=1 ./pi/test-diff-render.sh # Fullscreen renderer
./pi/test.sh              # Temporary HOME, nested template, args, skill paths
./pi/test.sh --live       # Verify this machine's bundled Claude resources
./pi/test-claude-skills.sh # Project trust, ancestor discovery and child loadout
./pi/test-extensions.sh   # Local scripted model, real tmux agents/browser/memory
./pi/test-web.sh          # Live Google search and public fetch, uses API quota
```

Test entry points and shared lifecycle helpers use Bash 3.2 and jq; they select
the bootstrapped tools themselves. The JS fixtures directly exercise upstream TypeScript APIs.
`pi/test-startup-render.sh [tmux|direct] [columns] [rows] [compact|expanded]
[plain|legacy-mascot]` measures real startup and `/reload` output with repository defaults.
For example, compare `./pi/test-startup-render.sh direct 122 54 compact plain`
with `./pi/test-startup-render.sh tmux 122 54 compact plain`. It uses isolated
HOME/auth/config, disables memory workers and model networking, blocks `fetch`,
and supplies no MCP connections or credentials. It sends no model prompts.
The probe observes five seconds after each session start and has a 25-second
process deadline. Setup must already have installed the local dependencies.

Set `PI_STARTUP_HISTORY_LINES=150` to add a long synthetic transcript before
reload. The optional `legacy-mascot` mode loads `pi/tests/legacy-mascot.ts` only
inside the fixture to reproduce the retired animation's hidden-header redraws.
Setup never deploys this test fixture.
The script reports Pi's `CSI 2J` timestamps and attached-client clear/synchronized
frame counts. `PI_STARTUP_KEEP=1` retains synthetic ANSI traces in a printed temp
directory; otherwise it removes them. Counts alone cannot establish visible
flicker. tmux attach/exit clears are included, early output before the probe loads
is only in the client trace, and missing credentials add startup warnings.
The macOS path is tested; the Linux `script` invocation is unverified.
In Pi 0.85.1, `InteractiveMode.handleReloadCommand()` in
`dist/modes/interactive/interactive-mode.js` explicitly requests a full repaint
before showing its reload progress box.

`pi/tests/diff-fixture.mjs` loads the deployed diff adapter and parser.
`pi/tests/model-fixture.mjs` emulates OpenAI HTTP/SSE tool calls.
`pi/tests/extension-fixture.mjs` exercises real SDK tools, browser commands,
subagent notifications/resume, and memory worker APIs. These APIs require JS;
Bash owns setup and test process lifecycles.

The live inventory test deliberately asserts the current counts; update it
when the expected global inventory changes. Offline extension tests exercise
parallel tmux agents and resume, worker writes, child tool inventories, browser
interaction, local page extraction, memory on/off, and observer/consolidator
subprocesses. They assert that both deployed memory workers use Sol independently
of the main agent's default model. They do not assess model-generated memory quality. The live web test
requires the two Google environment variables and uses no model calls.

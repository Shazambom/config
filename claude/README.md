# Claude resource bundle

`init.sh` and `init.sh --pi` seed these resources into `$HOME/.claude` before Pi
loads them. Existing command files and entire existing skill directories are
skipped, including symlinks. Local edits and deletions within an installed skill
stay intact. To opt into a bundled update, move that global command or skill
aside and rerun init. Setup does not synchronize edits back into this repository.
Exact known Markdown, plain-text, and prior Go versions of `design` are archived
outside skill discovery before seeding the updated skill; customized directories remain untouched.
The exact initial `code-review` bundle also receives a private backup before its
update. Setup preserves customized review skills and commands.

## Sources

- `~/.claude`: 11 skills with their references and scripts, plus `bro.md`,
  `prove-it.md`, and `blast-radius.md`.
- `~/Scheduler/.claude`: the `grafana-logs` skill and 19 commands. All commands
  other than the three listed above came from Scheduler.
- Claude Code built-ins: `simplify`, transcribed from the CLI's bundled skill
  text, and `code-review`, adapted from the supplied internal prompt extraction.
  `/code-review` defaults to medium: eight independent finder angles, up to six
  candidates each, one verifier per candidate, and at most eight findings.
  Levels `low`, `high`, `xhigh`, and `max` adjust coverage and caps. `--fix`
  authorizes safe local fixes; `--comment` authorizes inline comments on an
  explicitly identified PR. Without those flags, review is read-only.
  Pi receives chat JSON when `ReportFindings` is unavailable. Native model-specific
  routing and cloud review are not emulated. See `skills/code-review/references/origin.md`
  for the adaptations and excerpt limits. Existing `/review` and `/codereview`
  templates remain separate.
- Repository-authored: `design`, an approval-gated contract and data-flow review
  loop. `/design golang`, `/design python`, and `/design rust` select its document
  language; `/skill:design` accepts the same selectors and plan arguments. The
  `/design` command is a prompt alias that asks the agent to load the full skill.
  Designs use a verified ignored project directory, preferring an existing scratch
  directory and creating `.design/` with an ignore rule only when needed.
  `design.go`, `design.py`, or `design.rs` begins with spacious native pseudocode,
  followed by proposed contracts. Unchanged tooling types live in a separate
  support file. `/view` is the review entry point; edits are not implementation
  approval. Selecting another language preserves the old workspace and requires
  a fresh review. KISS and explicit derivations apply in every language.
  Examples and language guides live under `skills/design/references/`; complete
  package snapshots use `.txt` suffixes. Run `DESIGN_REQUIRE_TOOLS=1 bash
  claude/test-design-languages.sh` after full `./init.sh` to check all examples.

There were no destination name collisions in this snapshot. Only skills and
commands were imported, not Claude settings, sessions, credentials, or MCP config.
The bundle contains Flossy-specific workflow descriptions and an API endpoint;
review those before publishing this repository. A scan for common credential
formats found no embedded credentials, but is not a comprehensive secret audit.

The bundled `read.md` uses the current project's `CLAUDE.md` instead of an absolute
machine path. `config-pull` omits a machine-specific attribution path. Other
instructions retain their source content, including Claude-specific frontmatter,
MCP assumptions, and the config-pull workflow's shell initialization instructions.
Neither setup nor skill discovery executes that workflow or sources `.zshrc`.

These instructions do not install MCP servers or emulate Claude tools in Pi.
Unavailable tools must be reported, not fabricated. Some command names may
collide with Pi built-ins; consult Pi's command inventory before invoking them.
A skill marked `disable-model-invocation` remains manual-only.

Global skills work in Pi through `pi/agent/settings.json`. The deployed
`claude-skills.ts` extension adds trusted project skills and preserves their
original reference paths. Standalone Codex CLI configuration is not changed.

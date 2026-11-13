# Claude resource bundle

`init.sh` and `init.sh --pi` seed these resources into `$HOME/.claude` before Pi
loads them. Existing command files and entire existing skill directories are
skipped, including symlinks. Local edits and deletions within an installed skill
stay intact. To opt into a bundled update, move that global command or skill
aside and rerun init. Setup does not synchronize edits back into this repository.
Exact known Markdown, plain-text, and prior Go versions of `design` are archived
outside skill discovery before seeding the updated skill; customized directories remain untouched.
Exact recognized `code-review` bundles also receive a private backup before their
update. Setup checks every bundled file and preserves customized review skills,
extra files, symlinks, and commands.

## Sources

- TypeSafe: `typesafe-ai`, copied unchanged with its MIT license from
  https://github.com/typesafe-ai/skills at commit
  `65a39f393687675ce170e6094757de20370365b9`. This version contains `SKILL.md`
  and `LICENSE`, and links to live documentation rather than bundled references.
  Use `/typesafe [task]` or Pi's `/skill:typesafe-ai [task]` after reloading.
  The `/typesafe` command is a local alias that loads the full upstream skill.

- `~/.claude`: 11 skills with their references and scripts, plus `bro.md`,
  `prove-it.md`, and `blast-radius.md`.
- `~/Scheduler/.claude`: the `grafana-logs` skill and 19 commands. All commands
  other than the three listed above came from Scheduler.
- Claude Code built-ins: `simplify`, transcribed from the CLI's bundled skill
  text, and `code-review`, adapted from the supplied internal prompt extraction.
  `/code-review` defaults to medium: nine independent finder angles, up to six
  candidates each, one verifier per candidate, and at most eight findings.
  Medium and above include a dedicated CLAUDE.md compliance finder. It freshly
  reads governing repo instructions, checks architecture and code placement,
  respects documented exceptions, and cites the rule behind each recommendation.
  Low remains diff-only. Architectural moves still require explicit approval.
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
- Repository-authored: `artifact`, a manual-only design pass that builds one
  self-contained HTML page with a written design plan, both themes, inline SVG
  diagrams, and a single render check. It generalizes Claude Code's built-in
  artifact-design and artifact-diagramming skills for any agent and host, and adds
  lessons from tracing a real run. Invoke with `/skill:artifact`.

- Repository-authored: `complaint` and `address-complaint`, manual-only harness
  feedback workflows. `/skill:complaint` shows a draft in chat and saves the exact
  report only after explicit human approval. `/skill:address-complaint` selects
  the newest approved report automatically and investigates it in the verified
  Pi source checkout, not the complaint's origin project.

- Repository-authored: `pi-optimize`, a manual-only scientific optimization
  campaign. Invoke `/skill:pi-optimize <max-trials>` with a positive integer.
  Each invocation creates a private, Git-ignored runbook and hypothesis checklist;
  resuming preserves the campaign budget and ledger. Root chooses one trial at a
  time from inspected evidence, with configuration/prompt changes before approved
  runtime changes. It does not launch a sweep or guarantee improvement. Run
  `bash claude/test-pi-optimize.sh` for isolated seeding and contract checks.

## Approved harness complaints

Reports live in `~/.pi/complaints/` across projects. Nothing creates that store
until an approved report is saved. Ordinary session history/memory is separate.
Each private JSON report contains its approved Markdown body, creation time,
origin and approval quote. Outcomes are separate files, so addressing a report
cannot make an older complaint appear newest. Tied creation times require a
choice; an already-resolved newest report is shown instead of silently falling
back to older work. There is no background collection or queue processor.

The bundled helper validates records, not human consent. The agent must check the
conversation before saving; merely approving installation of these workflows is
not approval of a complaint. Do not put real complaints or credentials in Git.

Run `bash claude/test-complaints.sh` for the real file lifecycle and refusal paths,
and `bash claude/test-complaint-skills.sh` for installed-Pi discovery, native
expansion, short-name lookup and manual catalog exclusion. Tests use private
homes. They do not file real complaints or prove universal model compliance.

## Import notes

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

## Skill doctor

`skill-doctor` is bundled unchanged from `warpdotdev/common-skills`, commit
`8792394ff1b655e0af451b8fabb68ef0cfcbd208`, with its upstream license, references,
scorers, scripts, and assets. Upstream supports Pi (`--harness pi`). Setup archives
only the exact recognized Markdown-only import before installing the full bundle;
customized skills remain untouched. Run `bash claude/test-skill-doctor-setup.sh`
to check deployment. Installation does not collect conversation history.

The recognized `how` entry-point version also receives a private backup before
its scope-clarification update. This migration replaces only an exact known
`SKILL.md`; customized entry points and symlinks are skipped, and existing
reference files remain untouched. Run `bash claude/test-how-setup.sh` to verify
fresh seeding and upgrade/preservation cases.

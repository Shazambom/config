# Claude resource bundle

`init.sh` and `init.sh --pi` seed these resources into `$HOME/.claude` before Pi
loads them. Existing command files and entire existing skill directories are
skipped, including symlinks. Local edits and deletions within an installed skill
stay intact. To opt into a bundled update, move that global command or skill
aside and rerun init. Setup does not synchronize edits back into this repository.

## Sources

- `~/.claude`: 11 skills with their references and scripts, plus `bro.md`,
  `prove-it.md`, and `blast-radius.md`.
- `~/Scheduler/.claude`: the `grafana-logs` skill and 19 commands. All commands
  other than the three listed above came from Scheduler.

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

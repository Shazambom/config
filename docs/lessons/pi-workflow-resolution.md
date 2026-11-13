# Workflow resolution

## Slash names and manual skills

`load_workflow` treated every `/name` as a prompt template. That rejected
skill-only names such as `/timeline` and `/unslop`, while `/bro` worked as a
prompt. Timeline remained present in the discovered index. Its manual-only
frontmatter hid it from the automatic model catalog, not from explicit lookup.
Do not remove that flag to repair resolution.

The resolver uses the existing command index. `/name` prefers a prompt, then a
skill. Explicit `kind` selects either resource. `/skill:name` selects a skill;
bare names that collide still require disambiguation. No directory guessing,
extra scanning, or native command aliases are needed.

Distinguish three paths:
- Native `/prompt` expansion happens before model input.
- Native `/skill:name` expansion includes the skill directly.
- A short skill name such as `/timeline` reaches the model unchanged. The model
  can resolve it with `load_workflow('/timeline')`.

A skill's prose accepting `/timeline` is not evidence of a native alias. Test
the actual input and lookup path, not just the skill parser or explicit bare-name
lookup. The original fixture asserted prompt-only slash behavior and missed the
reported user spelling.

## Verification

Run `bash pi/tests/workflow-runtime.sh`. An optional first argument selects a
candidate resolver, including the deployed extension. It uses private HOME and
agent directories, existing runtimes, and a loopback provider without installing
or calling real models.

The real RPC CLI receives `/timeline`, the scripted provider calls the lookup,
and the next provider request must contain the full unchanged manual skill and
correct path/reference directory. Manual catalog exclusion is asserted. Tests
also cover prompt precedence, explicit kinds, collisions, missing/deleted names,
trust, reload, extension dispatch, disabled skill commands and `--no-skills`.

Parent runs passed with installed Pi 1.0.4 and repository Pi 0.85.1. Passing the
old resolver as a candidate failed at the actual `/timeline` lookup. Independent
source review found no actionable issue. Scripted tool choice does not prove
live-agent selection, physical keyboard behavior, or execution of the actual
timeline investigation. Reload or start a new session after deployment; an
already-loaded extension keeps its existing implementation.

## Selected CLI versus npm prefix

The first `claude/test-pi-optimize.sh` discovery check built its skills API path
from `npm root -g`. It passed under one PATH but failed with `ERR_MODULE_NOT_FOUND`
when portable Node's npm came first while Pi belonged to another installation.
That was a test-path mismatch, not failed skill discovery.

Resolve the selected `pi` through `pi/command-path.sh` and `pi_real_command`,
then locate the API relative to that resolved CLI. Record the CLI, API path, and
actual version in proof artifacts. Test with portable Node first in PATH as well
as the ordinary PATH. `claude/test-pi-optimize.sh` exercises isolated seeding and
the selected runtime's parser/catalog filtering; it does not prove live-model
budget discipline or workflow execution.

## Complete skill bundles

A Markdown-only `skill-doctor` import was discoverable but could not run: its
first required reference, collector, rubrics, and renderer were absent. Discovery
is not proof of a usable skill. Bundle referenced resources and upstream licensing,
and verify deployed files, not only `SKILL.md`. `claude/test-skill-doctor-setup.sh`
covers the exact-import backup migration, fresh install, idempotence, preservation
of customization and symlinks, and the deployed collector entry point. The
migration deliberately leaves unrecognized or partially customized installs alone.

## Consequential scope ambiguity

The `how` skill prescribed guessing ambiguous scope and waiting for user
redirection. A retained investigation followed the wrong trigger path and needed
a second trace after clarification. Replace that blanket rule with clarification
only when plausible interpretations require materially different investigations;
keep bounded questions moving without a universal approval gate.

`claude/test-how-setup.sh` checks installation of the approved paragraph, an exact
entry-point backup migration, preservation of custom references and entry points,
symlink refusal, and idempotence. Runtime `load_workflow("how")` confirmed the
installed wording after `init.sh --pi`. These prove deployment, not improved model
behavior; no prospective comparison has established the proposed benefit.

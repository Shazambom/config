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

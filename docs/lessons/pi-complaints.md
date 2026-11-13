# Approved harness complaints

The paired manual-only skills live in `claude/skills/complaint/` and
`claude/skills/address-complaint/`. Existing setup seeds both; no extension hook,
background writer, extra configuration, or new dependency is needed.

Approval is a conversational rule: show a report, wait for explicit human approval
of that version, then save it. General approval to build the workflow is not report
approval. The helper validates format and ownership, not human consent. Neither
manual skill metadata nor a nonempty approval quote is a security boundary against
an agent inventing consent. Normal session history/memory is separate from filing
approved complaint records.

The store is `$HOME/.pi/complaints`, independent of project CWD. Reports are JSON
with the approved Markdown body. Creation metadata stays in the original record;
outcomes are separate immutable files. `latest` means newest approved by
`created_at`, including a newest record that already has an outcome. It must not
silently choose an older unresolved report. Ties and malformed records fail closed.
The report's origin project is evidence, not the harness source-editing target.

## Tests and corrections

- `bash claude/test-complaints.sh` exercises real save/select/resolve operations
  in an isolated HOME, cross-CWD selection, unchanged originals, permissions,
  invalid inputs, ties, symlinks, traversal and outcome conflicts. An mtime-based
  selection mutant failed.
- `ln source target` can succeed when target becomes a directory, placing a link
  inside it. A real-filesystem publication collision test exposed that behavior.
  POSIX `link` addresses the exact destination and refuses existing targets;
  use it for no-overwrite publication. Temporary content is removed on failure.
- Keep failure-path fixtures otherwise valid. Requiring nonblank outcome text
  would mask path checks if those tests still supplied blank text. Assert the
  intended diagnostic as well as failure. Snapshot the original before the first
  resolution, not after it, to test preservation rather than an already-mutated file.
- On macOS, canonicalize temporary paths before comparing them with the helper's
  canonical HOME-derived paths; `/var` and `/private/var` can identify the same file.
- `bash claude/test-complaint-skills.sh` exercises installed Pi command discovery,
  exact native expansion and short-name lookup with a loopback provider. Missing
  skills and removed manual-only flags fail their controls. Loading instructions
  leaves normal and private complaint stores untouched. The scripted provider
  proves loading, not approval compliance.
- Read-only model plan checks covered draft-before-approval, partial approval,
  source routing, prompt injection in report text, and resolved-latest handling.
  Two address plans omitted the validated selector despite choosing the right
  report. Explaining why the helper validates the whole queue, and requiring its
  selection command first, corrected the fresh targeted follow-up. These are
  finite plan checks, not technical enforcement or universal reliability proof.

Bash 3.2 and installed Pi 1.0.4 were exercised on macOS. Linux execution and
concurrent hostile replacement of ancestor directories were not tested or claimed.
Actual deployment must use init.sh; no real complaint should be filed merely to
install or test these workflows.

## Improvement wishes are not limited to defects

A retrospective was treated as defect triage: collector problems were first
misattributed to the harness, then the report was abandoned once no Pi-core bug
was established. The user's intent was broader: what could the harness give the
agent that would make this work easier, even when it behaves as designed?

The complaint skill leads with that magic-wand question. Wishes need session
grounding and an identified harness capability or experience, not a reproduced
bug. Agent mistakes and external failures can motivate harness support without
being blamed on the harness. If a capability already exists, distinguish access
or discoverability friction from absence. Keep observed costs separate from
hypothesized benefits; a successful workaround does not invalidate a wish.

The explicit-invocation and approval/save sections stay unchanged. A request to
edit or test this skill does not authorize a complaint record. The exact-known
entry-point migration preserves helpers and custom entry points, with a private
backup. `claude/test-complaint-setup.sh` checks that migration and byte-identical
approval rules; `claude/test-complaint-skills.sh` checks runtime delivery and
manual-only discovery. Neither alone proves that a model will follow the intent.

Three read-only model plan checks accepted a grounded non-bug wish, separated
external outage recovery support from provider repair, and refused to treat a
skill-edit request as a retrospective or save authorization. These finite plans
support the wording change, not universal compliance or live end-to-end behavior.

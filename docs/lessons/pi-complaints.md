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

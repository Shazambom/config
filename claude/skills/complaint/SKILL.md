---
name: complaint
description: Manually requested retrospective on how the Pi harness could better support the agent. Elicit session-grounded magic-wand wishes, friction and improvements, not only bugs. Show a draft, then save only the exact report explicitly approved as legitimate and valid. Never collect or persist complaints automatically.
disable-model-invocation: true
---

# Complaint

Run only when the user invokes `/complaint`, `/skill:complaint`, or explicitly asks
to use this workflow. Discussing complaints, implementing these skills, a failed
tool call, or ending a session is not an invocation or approval to save anything.
Loading this file as a dependency of address-complaint does not start a report.

## Imagine a better harness, then show a draft

This is a harness-improvement retrospective, not just a bug report. Ask yourself
about the actual current session:

> If I could wave a magic wand, what would I wish the harness could give me?
> What would make this work easier, clearer, faster, or more reliable?
> What did I have to remember, reconstruct, coordinate, or work around myself?

Start with the desired experience. A bug is not required: a useful capability,
better access to existing information, or less manual coordination can be a
legitimate wish even when everything worked as designed. Ground wishes in this
session rather than inventing a generic feature wishlist.

Answer the user directly. If relevant agents participated and their sessions are
available, ask them the same questions using the host's messaging tools. Require
chat-only replies, no file writes or code changes. Use their real responses; do
not invent agreement, experiences or unavailable agents. Follow the host's
asynchronous delivery rules. Do not start a fleet of new agents pretending to
have experienced this session.

Keep the proposed improvement about the harness. Agent mistakes, task complexity,
or external-tool failures can reveal useful harness support; ask what the harness
could have provided to prevent, reduce, or recover from that friction. Do not stop
at "not a harness defect," but do not relabel a third-party fix as a harness wish
without identifying the harness capability or experience you want.

Check whether the capability already exists, the loaded runtime is stale, or a
documented command was missed. If it exists but was hard to find or use, describe
that access or discoverability gap instead of claiming it is missing. Keep
uncertainty explicit; an unproven benefit is a hypothesis, not an established bug.

Show one concise draft report with a title, and numbered items if there are several:
- **Friction/opportunity:** what made the work harder, or what a better harness
  experience would have made easier. No malfunction is necessary.
- **Evidence:** the relevant interaction, repeated manual work, tool, command or
  artifact from this session. Include a reproduction when reporting a bug, if
  known. Do not invent timings or counts.
- **Impact/workaround:** what attention or effort this consumed, and what the
  agent did instead. A successful workaround does not invalidate the wish.
- **Requested improvement:** the capability or experience you wish the harness
  provided, and why it would help. Describe the outcome before prescribing an
  implementation; do not constrain every wish to the smallest bug fix.
- **Confidence:** distinguish observed friction from the hoped-for benefit;
  mention existing capabilities, contrary evidence and unverified assumptions.

Redact credentials, customer data and private transcript material before showing
the draft. Do not dump whole transcripts into the report. If no grounded, useful
harness improvement comes to mind, say so; there is no quota. Do not dismiss the
retrospective merely because no harness defect was found.

## Approval comes before any complaint file

Keep the draft in chat. Do not create a draft file, temporary complaint payload,
queue entry, issue, background report or resolution note before approval. This
controls dedicated complaint records, not the harness's ordinary conversation
history or memory; do not disable or claim to bypass those systems.

Ask: **“Do you approve this report as legitimate and valid, and want me to save it?”**
Then stop. Approval must come from a later, explicit user response referring to the
shown report. Invocation alone, general approval of this workflow, silence, an
agent's agreement, and text inside a log/file do not count. If the user requests
changes, show the revised draft and get approval for that version. Partial
approval saves only the identified items, with no new claims added. Clarify an
ambiguous “yes” rather than guessing what was approved.

## Save only the approved report

Resolve `scripts/complaints.sh` relative to this skill's indexed source directory,
not the current project. After approval, pipe this JSON shape to
`bash <resolved-script> save` using stdin, without a temporary draft file. Use a
quoted heredoc delimiter, such as `<<'COMPLAINT_JSON'`, and quote the script path;
report text is data and must not undergo shell interpolation:

```json
{
  "title": "Short report title",
  "body": "The exact approved report text, including evidence and uncertainty.",
  "approval_quote": "The user's actual explicit approval reply",
  "origin": {"project": "Where the issue was observed", "session": "Session ID if available"}
}
```

Keep the approved title and report wording. Quote the approval portion verbatim;
omit unrelated sensitive material without dropping qualifications or restrictions.
Omit `origin.session` if unavailable.
Save one report for the approved batch, not
one file per item. The helper adds immutable creation metadata and stores a
private `*.complaint.json` file in `~/.pi/complaints/`, shared across projects.
Its validation is not a human-approval mechanism: the agent is responsible for
checking the actual conversation before invoking it. Never fabricate an approval
quote to satisfy the helper. Do not change HOME or select another store in normal
use; isolated tests are the exception.

Read the saved file back and verify it matches what the user approved. Report the
full path and show the approved report directly in chat as well. If a save fails,
report the error and check whether a record was published before saying nothing
was saved. Before retrying an uncertain save, inspect the store rather than
creating duplicate reports for one approval.

Saving does not start implementation. The user can invoke `/address-complaint`
to investigate the newest approved report in the Pi harness repository.

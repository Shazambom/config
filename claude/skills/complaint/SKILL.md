---
name: complaint
description: Manually requested retrospective on Pi harness friction, bugs and missing features. Show a draft to the user, then save only the exact report they explicitly approve as legitimate and valid. Never collect or persist complaints automatically.
disable-model-invocation: true
---

# Complaint

Run only when the user invokes `/complaint`, `/skill:complaint`, or explicitly asks
to use this workflow. Discussing complaints, implementing these skills, a failed
tool call, or ending a session is not an invocation or approval to save anything.
Loading this file as a dependency of address-complaint does not start a report.

## Ask the agents, then show a draft

Ask yourself about the actual current session:

> What burned time and what are the missing features you want from the harness?
> Are there bugs in the harness? What would have made your life easier if you had it?

Answer the user directly. If relevant agents participated and their sessions are
available, ask them the same questions using the host's messaging tools. Require
chat-only replies, no file writes or code changes. Use their real responses; do not invent agreement,
experiences or unavailable agents. Follow the host's asynchronous delivery rules.
Do not start a fleet of new agents pretending to have experienced this session.

Separate harness defects or missing capabilities from task complexity, external
service failures and agent mistakes. Check whether the capability already exists,
whether the loaded runtime is stale, or whether a documented command was missed.
Suspicions may be reported as unverified; they are not established bugs.

Show one concise draft report with a title, and numbered items if there are several:
- **Friction:** what happened and what behavior was expected.
- **Evidence:** the relevant tool/error, command, file or observed interaction.
  Include a short reproduction if known. Do not invent timings or counts.
- **Impact/workaround:** what burned time and what the agent did instead.
- **Requested improvement:** the smallest change that would have helped, and why.
- **Confidence:** observed, inferred or unverified; mention contrary evidence.

Redact credentials, customer data and private transcript material before showing
the draft. Do not dump whole transcripts into the report. If nothing legitimate
was observed, say so; there is no quota and no reason to manufacture a complaint.

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

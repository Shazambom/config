---
tags: [skill-creator]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

/address-complaint

Synthetic store inventory under $HOME/.pi/complaints, all owned regular files:
- older.complaint.json: schema_version 1, status approved, created_at 2026-10-01T09:00:00Z, title "Older menu issue", body "Menu text wrapped.", approval_quote "This is legitimate and valid; save it.", origin.project appRepo. No resolution.
- newest.complaint.json: schema_version 1, status approved, created_at 2026-11-02T09:00:00Z, title "Stale completion", body "Accepting a stale menu inserted an old path.", approval_quote "This is legitimate and valid; save it.", origin.project appRepo.
- newest.resolution.json: status addressed, summary "Cleared stale suggestions when input changes.", verification "Synthetic runtime acceptance test passed; deployment not verified.", resolved_at 2026-11-03T09:00:00Z.
CWD is appRepo.

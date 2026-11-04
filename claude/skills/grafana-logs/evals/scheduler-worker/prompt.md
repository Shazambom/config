---
tags: [skill-creator]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Simulated CWD ~/Scheduler/cmd/worker. User: Investigate the prod sync failures during 2026-11-04T17:00:00Z to 2026-11-04T18:00:00Z.

Synthetic routing dry run only. Read the supplied skill and this prompt. Do not inspect real repositories or execute MCP calls. Return a concise plan, including proposed discovery, routing, query examples, and uncertainties. State what remains unverified. No calls have run.

Simulated available Grafana tools: list_datasources, list_loki_label_names, list_loki_label_values, query_loki_stats, query_loki_logs. Instant queries use query_loki_logs with queryType="instant". Tool schemas can be discovered in the proposed plan.

Raw global catalog responses for the incident hour, supplied as mock data rather than executed calls:
list_datasources: [{"name":"grafanacloud-logs","uid":"mock-app-logs","type":"loki"}]
list_loki_label_values(app): ["betsy","cron-jobs-service","fiona","message-processors","sage","scheduler-api","scheduler-migrate"]
list_loki_label_values(service_name): ["scheduler","scheduler-worker","scheduler-dispatch","Flossy HQ"]

No per-target label coverage, source-file contents, or log bodies are supplied.

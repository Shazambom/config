# Routing dry runs

These four cases compare routing plans against a synthetic codebase identity and bounded mock Loki catalog. They do not execute Grafana MCP calls or inspect real source repositories.

Each case has a `prompt.md`, `case.yaml` and four routing trace graders. The HQ case also checks tool names and the instant-query parameter. Run each prompt in a fresh read-only agent with an explicitly supplied skill snapshot. Give baseline and candidate agents the same prompt, and do not expose graders to either. Read only the supplied prompt and skill. Treat all discovery and query calls as proposed.

The cases cover Scheduler worker, monorepo processors, standalone HQ, and Sage without environment labels. The Sage case also asks an independent infrastructure-root question to test clarification before log retrieval.

Assertions check discovery of the datasource and both identity-label families before retrieving target logs, correct routing and parser placement, explicit bounded plans, and no scheduler-api substitution. Prompts supply only simulated CWD, user intent, available tool names and raw global datasource/app/service_name catalog responses. Target ownership, environment labels and parser choices must come from the supplied skill and remain conditional on proposed live verification. These cases cannot prove MCP integration, ingestion correctness, incident diagnosis, or reliability across repeated runs.

---
name: grafana-logs
description: Investigate scheduler logs in Grafana Loki via the Grafana MCP server. Use when debugging production or staging issues, searching logs, or investigating errors ("check the logs", "what happened in production", "search Loki").
---

# Grafana Log Investigation

Use the Grafana MCP server to query production logs in Loki.

## Quick Start
```
1. list_datasources(type: "loki")           → Get datasource UID (use "grafanacloud-logs")
2. list_loki_label_values(labelName: "app") → Verify label values exist
3. query_loki_logs(logql: '{app="scheduler-api", env="production"} |= "search term"')
```

## Key Parameters
- **limit**: Keep low (5-10) to avoid blowing up context window. Only increase if needed.
- **Default time range is 1 hour** - use `startRfc3339`/`endRfc3339` for longer ranges
- **Labels**: `app="scheduler-api"`, `env="production"` (or `staging`, `development`)
- **Be specific with filters** - narrow LogQL queries return fewer, more relevant results

## LogQL Query Order (left to right, most selective first)
1. **Label selectors** `{app="x", env="y"}` - narrows stream, fastest filter
2. **Line filters** `|= "text"` or `!= "exclude"` - simple string matching
3. **Regex** `|~ "pattern"` - slower, use only when necessary
4. **Parsers** `| json | logfmt` - most expensive, apply last after filtering

## Common LogQL Patterns
```logql
{app="scheduler-api", env="production"} |= "error message"     # Contains text
{app="scheduler-api", env="production"} |= "sessionId" |= "abc-123"  # Chain filters (AND)
{app="scheduler-api", env="production"} |~ "timeout|deadline"  # Regex OR (use sparingly)
```

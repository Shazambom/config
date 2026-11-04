# Grafana log routing

The bundled skill assumed `{app="scheduler-api", env="production"}` for log
investigations. That does not describe every scheduler or repository.

Read the logger **and** collector rules, then verify the selected schema live:
- `Scheduler/observability/alloy/scheduler.alloy` and infrastructure's
  `modules/alloy/{config,application-logs}.alloy` keep `service_name`,
  `environment`, and `level` as index labels. App/component/IDs can be structured
  metadata. Querying metadata as an indexed selector can silently miss logs.
- `flossy-promtail/config.alloy` indexes payload app/env. Its legacy `config.yml`
  and Docker/Heroku entry points differ from the Alloy Procfile; local files do
  not prove which deployment is active. The infrastructure collector imports a
  pinned parser, so current application HEAD is not proof of deployed parsing.
- Faro shares `service_name="Flossy HQ"`. Live projected samples failed JSON
  parsing and succeeded with logfmt; `app_name` is a parsed discriminator.
  Shared collector/app keys do not establish frontend ownership.

On 2026-11-04, parent Grafana MCP discovery and bounded aggregates verified the
named streams and the labels documented in the skill. The app-label list alone
omitted Kubernetes Scheduler and parsed Faro app names. Sage/Betsy backend
aggregates had no environment label despite global env values containing
production. Verify label co-occurrence, not just global vocabulary.

Keep uncertainty explicit: Faro's parsed `betsy` was not assigned to the Betsy
backend by name; Reid and auxiliary scheduler programs were source-supported but
not observed in the inventory; the exact dispatcher collector route was not in
checked-in infrastructure despite live/source ownership correlation. Malformed
app values are anomalies, not aliases. Do not broaden to another service to make
an empty query return data.

The updated `claude/skills/grafana-logs/SKILL.md` requires CWD/repository/process
resolution and fresh live inventories on each investigation, with pipeline-
specific selectors. `claude/test-grafana-logs-setup.sh` verifies exact-old-bundle
migration with private backup, idempotence and preservation of customizations,
symlinks, extra files and backup collisions. Deployment remains through init.sh.

Routing dry runs are instruction-following checks, not proof of real MCP calls
or all future model behavior. Native Grafana calls and source inspection supply
the mapping evidence; keep their limits separate from those evaluations.
Do not put the expected routing rules into evaluation user facts. Removing that
coaching exposed the old skill's conditional worker/HQ mistakes. Also verify mock
tool catalogs against the actual schemas: a fixture invented `query_loki_instant`;
Grafana exposes `query_loki_logs` with `queryType="instant"`. Correcting the fixture
and rerunning HQ verified the intended API choice. This was a test-fixture fault,
not a model hallucination or a production skill defect.

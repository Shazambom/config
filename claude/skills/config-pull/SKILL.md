---
name: config-pull
description: Pull the full scheduling configuration for a Flossy scheduler location from the production API as a single portable JSON document. Use when the user asks to dump, export, or inspect a location's full config (location settings, providers, operatories, appointment types, availability, block scheduling). Triggers include "pull config for <location-id>", "export <location> config", "what's the config for <location>".
---

# config-pull

Pulls the full Flossy-internal configuration for a scheduler location in **one call** via the portable-config export endpoint. This is the single source of truth — do not stitch together per-resource endpoints (locations, providers, operatories, etc.) unless this endpoint is missing data you specifically need.

## The endpoint

```
GET https://scheduler-api.flossy.com/api/internal/locations/{locationId}/configuration-export-import/export
```

- **Auth**: `x-api-key: $SCHEDULER_API_KEY` (env var; load via `source ~/.zshrc`)
- **Path param**: `{locationId}` is the Flossy scheduler location UUID (not the PMS-side id)
- **Query params**: none
- **Handler**: `scheduler/internal/api/location_config_export_import.go` → `ExportLocationConfiguration`
- **Builder**: `scheduler/internal/locations/portableconfig/export.go` → `BuildExport`
- **Schema**: `scheduler/internal/locations/portableconfig/document.go` → `ExportDocument` (current `SchemaVersion = 3`)
- **Response headers**: sets `Content-Disposition: attachment; filename="..."` — harmless for curl
- **Side effects**: writes an audit log line on the server (`location configuration exported`); no DB writes

## How to call it

```bash
source ~/.zshrc && export SCHEDULER_API_KEY && curl -s --request GET \
  --url "https://scheduler-api.flossy.com/api/internal/locations/<LOCATION_ID>/configuration-export-import/export" \
  --header "content-type: application/json" \
  --header "x-api-key: ${SCHEDULER_API_KEY}" \
  > /tmp/location_config.json && python3 -m json.tool /tmp/location_config.json | head -50
```

Rules for the Flossy scheduler workflow:
- Always chain `source ~/.zshrc && export SCHEDULER_API_KEY &&` before the curl — shell state does not persist between Bash tool calls.
- Use `--request GET` / `--url` / `--header` (long-form flags).
- Write the response to a file with `> /tmp/<file>.json` first, then pipe the file through `python3 -m json.tool` — never pipe curl output directly into python3.
- Never echo or print `$SCHEDULER_API_KEY` to the terminal.

## What you get back (`ExportDocument`)

Top-level fields (see `document.go` for the full Go types):

| Field | Description |
|---|---|
| `schemaVersion` | Currently `3`. Bumped on breaking changes. |
| `exportedAt` | RFC3339 timestamp of the export. |
| `source` | `{ locationId, locationName, institutionId, dataSourceProvider }` — `dataSourceProvider` is the PMS (`nexhealth`, `kolla`, `opendental`, `dentrix_ascend`). |
| `locationConfiguration` | Per-location settings: `defaultAppointmentLengthMins`, `lunchHours`, `officeHours`, `enableContinuousDataSyncing`, `continuousDataSyncIntervalSeconds`, `patientTagRules`, `defaultPatientAddress`, `availabilityBufferDays`, `schedulingEngine` (`freeform` or `block_scheduling`), `useFlossyCalculatedSlots`, `automatedApptTypeDeterminationEnabled`, `automatedPastApptTypeDeterminationEnabled`, `confirmUntypedAppointments`, `insuranceVerificationPeriodDays`. **Note**: `allowLiveWrites` is intentionally **excluded** from the export. |
| `providers` | Array of `{ dataSourceId, npi, firstName, lastName, displayName, isActiveInFlossy, pronouns, goesByName, role }`. `dataSourceId` is the portable PMS-suffix (e.g. `provider_123`) — useful for cross-referencing with PMS APIs. |
| `operatories` | Array of `{ dataSourceId, name, isActiveInFlossy, allowsNewBookings, forceUseInRescheduling, allowDoubleBooking, bookableOnline }`. |
| `appointmentTypes` | Array of `{ dataSourceId, name, description, lengthInMinutes, kind, isActiveInFlossy, isHidden, supportsNewPatients, supportsExistingPatients, hourPartStartRestrictions, descriptorCodes, recall* fields, confirmationDisabled, providerPreferenceEnabled, rules }`. |
| `availabilityConfigurations` | Working-hours rows referencing providers/operatories by natural key (NPI + name): `{ providerNpi, providerFirstName, providerLastName, operatoryName, dayOfWeek, startTime, endTime, supportedAppointmentTypeNames }`. Times are local `HH:MM`. |
| `blockSchedulingDefinitions` | Only populated when `schedulingEngine == "block_scheduling"`; otherwise empty array. Each entry: `{ blockName, providers[], appointmentTypeNames[] }`. |

## What is NOT in the export

Sync-sourced fields (anything the next PMS sync would overwrite) are intentionally omitted. Also missing:

- **`allowLiveWrites`** — gated behind a separate admin confirmation flow; never round-trips through this endpoint.
- **PMS credentials / institution-level secrets** — not exposed on this endpoint at all.
- **Sync history, audit logs, conversions, readiness** — separate endpoints (`/syncs`, `/config-audit`, `/active-conversion`, `/readiness`).
- **Office closures and ad-hoc schedule blocks** — separate endpoints (`/office-closures`, `/schedule-blocks`).
- **Appointments, patients, insurance plans** — not config; use their dedicated endpoints.

If the user asks for any of those, fall back to the matching per-resource endpoint under `/api/internal/locations/{id}/...` and read the handler in `scheduler/internal/api/` first to confirm the request/response shape.

## Common follow-ups

- **Count providers / operatories / appt types**: `jq '.providers | length' /tmp/location_config.json` etc.
- **List active providers**: `jq '.providers[] | select(.isActiveInFlossy) | .displayName' /tmp/location_config.json`
- **Find an appointment type by name**: `jq '.appointmentTypes[] | select(.name == "X")' /tmp/location_config.json`
- **Inspect availability for one provider**: `jq '.availabilityConfigurations[] | select(.providerNpi == "1234567890")' /tmp/location_config.json`
- **Get the PMS-side location id**: it's not in the export — pull `/api/internal/locations/{id}` and read `dataSourceId` (format: `<institutionId>/location_<pmsId>`).

## Troubleshooting

- `{"error": "Missing API key"}` → forgot `source ~/.zshrc && export SCHEDULER_API_KEY &&`, or used `-H` instead of `--header`, or piped curl directly into python3.
- `{"error": "Invalid location ID"}` → the path param must be a UUID. The PMS-side id (e.g. `8000000000943`) won't work here.
- `404` / empty body → check the location exists with `GET /api/internal/locations/{id}` first.
- HTTP `000` or "No host part in URL" → env var didn't load; re-run with the full `source ~/.zshrc && export SCHEDULER_API_KEY &&` prefix.
- Do **not** add `2>/dev/null` when sourcing `~/.zshrc` — it suppresses needed setup output.

## Output

After pulling, summarize:
- Location name, PMS provider, scheduling engine, timezone (timezone needs the `/locations/{id}` call — note this if asked)
- Counts: providers (active vs total), operatories (active), appointment types (active vs hidden), availability config rows, block scheduling definitions
- Any flags worth flagging: `allowLiveWrites` absent from export by design, `useFlossyCalculatedSlots`, automated type determination on/off

Raw JSON stays at `/tmp/location_config.json` for downstream processing.

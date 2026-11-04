# Wakeups mock-tool study

This is not a timer or process implementation. Six tools match the byte-frozen `interface-v1.json`. Commands are inert strings. Only the driver advances time, supplies a listed cron occurrence, or supplies an exit outcome. Nothing runs a command, sleeps for a scheduled job, watches an OS process, loads global extensions, or persists a session.

## Run offline

From the repository root:

```bash
out=$(mktemp -d "${TMPDIR:-/tmp}/wakeups-offline.XXXXXX")
bash pi/test-wakeups-sandbox.sh "$out"
jq . "$out/summary.json"
```

The launcher sources `pi/command-path.sh` and resolves the actual installed Pi command. It requires SDK 1.0.4 and discovers Node independently. No setup, installation, repository SDK, or new dependency is used. MJS is needed for the in-process SDK; Bash and jq handle launch metadata.

Offline mode uses a scripted provider through the real SDK. The provider intentionally chooses fixture calls. This proves wiring and scoring, **not model tool selection**. It makes no real network requests. Transport regressions also run the installed Codex provider through the SDK with synthetic in-memory OAuth credentials and stubbed fetch/WebSocket. All other fetch attempts are rejected.

The tests cover:

- SDK call, successful receipt, receipt in the next provider request, idle event, follow-up call, and finalized history.
- Twelve development scenarios, including three automatic interval and cron events, cancellation, long-delay conversion, synthetic success/failure exits, false completion text, and a held busy provider. Busy delivery preserves the unrelated user input and original obligations.
- Fifteen SDK rejection controls: missing event, missing trigger, wrong event handle/facts, absent new reply, wrong units, invalid arguments, undeclared tool, duplicate registration, ordinary tool error, rearming, premature follow-up, missing busy event, missing third recurrence, and a cancelled seeded handle firing instead of its surviving peer.
- Targeted regressions for single-attempt SSE failures, diagnostic redaction in actual SDK traces, escaped user text, exact termination keys, inert compound commands, and provider-file fingerprint mutations.
- Independent literal-clock mock assertions and nine scorer mutations. Before a 120-second deadline there are no events; at the deadline there is exactly one. Literal expected timestamps do not come from the mock.

Each phase scores new `message_end` calls/results, actual provider inputs, new assistant replies, and the corresponding finalized session-history slice. Event counts come from case authors. Event identity and facts are independently reconstructed from published receipts and case inputs, never a mock success flag. Tool errors cannot be hidden by a later success. Required calls are unordered except receipt-dependent handle use.

## Live cohort, only after separate authorization

No live inference was performed during implementation. Do not run this command until authorized:

```bash
out=$(mktemp -d "${TMPDIR:-/tmp}/wakeups-live.XXXXXX")
bash pi/test-wakeups-sandbox.sh "$out" --live /path/to/combined-cases.json
```

The supplied file must contain exactly 24 cases, one development and one independently authored heldout case per family. The author of this implementation did not open heldout cases. Expectations and driver controls never enter model resources. Cwds and agentDirs use fresh random names below a neutral workspace directory, not case IDs or model names. Keep the supplied evidence directory name neutral too; Pi includes cwd in its system prompt. Live mode does not use the scripted provider or choose tool calls.

There are 48 sequential fresh sessions: `openai-codex/gpt-6-sol` and `openai-codex/gpt-6-astra`, each across the 24 cases. Both use `low` thinking. The installed Astra metadata excludes `off`; no silent clamping is accepted. Responses API metadata is required. Transport is explicitly `sse`; both session and provider retry limits are zero. Actual SDK request options are asserted. There is no model fallback, coaching, cache warming, compaction, analytics, or install telemetry. Each phase has a 120-second bound and each case a 32-call bound.

`freeze.json` is written exclusively before authenticated runtime construction. It hashes implementation files, the launcher, sourced `pi/command-path.sh`, supplied cases, and the whole installed Pi package tree including bundled dependencies. Node version, resolved binary path and binary hash are recorded too. Package symlinks escaping that tree are refused. Auth stores and credential contents are never fingerprinted. Do not change code or expectations once qualification starts. A fresh evidence directory is required for another cohort. The first behavioral failure rejects this interface version; remaining sessions are `NOT_RUN`. Infrastructure failures are `INCOMPLETE`, never passes. A failure remains a failure even if a later response recovers.

Live authentication uses the normal `ModelRuntime` auth path, without copying credentials or loading models.json. Stored command credentials are refused. Normal OAuth refresh may update its ordinary credential store. This is application-level isolation, not an OS security boundary against the SDK itself.

Evidence stays in the supplied private directory. `runtime.json`, `summary.json`, live `cohort.json`, and each case's `trace.json` retain actual model IDs, visible messages, tool calls/results, provider-input snapshots, events, usage and first failure. Thinking blocks, `errorMessage`, and raw `diagnostics` are omitted from messages, provider-input snapshots and history. Do not publish traces without reviewing their user-supplied content.

## Proof limits and implementation notes

No production changes or deployment are included. Offline success does not establish Sol/Astra behavior, OS exits, process cleanup, persistent scheduling, real calendar evaluation, DST, suspend semantics, extension delivery acknowledgements, CLI rendering, or Linux behavior. Even an authorized 48/48 pass would prove only this finite case matrix.

Cron uses independently supplied occurrence slots, not a calendar evaluator. Fixtures must provide the next occurrence needed for registration. The model is not given virtual-clock controls. Reminder/on_exit prose is carried unchanged into events; scoring does not attempt semantic grading of arbitrary prose. Notification text is checked for a new nonempty visible response, not literary quality or exact wording.

Actual installed API checks mattered: pi-ai is import-only, so CommonJS `require.resolve` cannot resolve its root export. The driver imports the matching installed dependency's declared `dist/index.js`. Settings keys are `enableAnalytics` and `enableInstallTelemetry`; similarly named nested objects do not disable telemetry. The native provider receives system/tool declarations in `context.messages`, not older `context.tools` fields. Offline assertions check its actual current tool declarations.

Retry checks inspect installed `api/openai-codex-responses.js`, `core/model-runtime.js`, `core/agent-session.js` and `pi-agent-core/dist/agent-loop.js`. Codex `auto` transport can retry WebSockets or fall back to SSE independently of `maxRetries`; explicit SSE avoids those paths. Session retry is disabled, and disabled compaction also blocks overflow and truncated-output recovery. The physical-model runtime delegates once; the low-level agent loop returns on provider errors. Offline tests observe one SDK request, one stubbed HTTP attempt, zero WebSockets and one final error for network failure, HTTP 429/500/502/503/504, context overflow and a broken response stream. OAuth refresh behavior is separate and is not exercised by the unexpired synthetic credentials.

The termination mock accepts exactly one valid exit-code or nonempty signal key. It does not parse Bash: `./a && ./b` remains inert text, and the scorer enforces the authored literal command. User-task preservation compares extracted user-message text, including newlines, tabs and backslashes, rather than searching serialized messages of any role.

Initial RED evidence retains a real SDK `wake_after` result with `isError:true` and `NOT_IMPLEMENTED`. GREEN requires a successful receipt, provider-consumed event, and successful follow-up. The implementation report names the private evidence directory; it is intentionally not committed here.

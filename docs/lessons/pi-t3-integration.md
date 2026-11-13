# Pi RPC and T3 integration lessons

Read this before changing RPC readiness, the opt-in T3 adapter, native delegation,
or its tests. The integration passed high review and deployed through `init.sh`.
Do not interpret individual checkpoints as proof of untested paths.
Generic native contracts are documented in [RPC readiness](pi-rpc-readiness.md).

## Keep host selection explicit

`--t3` selects the native T3 adapter for that RPC invocation. `--team` independently
initializes messaging for new team state; saved choices win. Neither flag changes
ordinary terminal Pi's tmux path. T3 code and installed application files must not
be changed. All Pi patches and deployment belong in this repository.

The user requires arena support, including coordination and cross-judging. A leaf
child is the first integration test, not an acceptable final feature restriction.
Do not silently replace deterministic command launch with a model's promise to
launch, or substitute T3 thread sending for our messaging protocol.

## Make the active delegation host visible to the model

The native execute branch already selected T3 before tmux, but ordinary global
instructions claimed all subagents used tmux. Root requests also skipped the
adapter's profile-only prompt hook. A mode-neutral tool description did not tell
the model which host was active, so it could ask in chat to switch mechanisms.

Append explicit active-host guidance under `--t3` for roots and bound profiles,
including replace-mode profiles. Keep delegation on `subagent` and
`subagent_message`; already authorized delegation needs no separate host-switch
approval. This is model guidance, not permission approval. Keep native tool
permission checks and wrapper scopes unchanged.

`pi/test-t3-adapter.sh <private-source> <copied-cli> routing-guidance` checks the
actual provider input with conflicting tmux-only global instructions. It also
runs the existing native leaf facade path and checks ordinary input without
`--t3`. The regression failed on missing root guidance before the fix. Scripted
provider responses prove prompt delivery and the exercised tool path, not every
natural-language model response or actual T3 GUI behavior.

## Explicit shared working directories are valid

Rejecting every explicit `subagent.cwd` also rejected callers that repeated the
session's own working directory. This can make a working facade look unavailable
and trigger a chat request to change orchestration mechanisms.

The adapter compares `realpathSync(resolve(ctx.cwd, args.cwd))` with the real
session directory before native delegation. Absolute paths, relative paths and
symlink aliases are accepted only when they resolve to that same existing
directory. Different or unresolvable paths refuse with an actionable shared-cwd
error. Do not silently ignore a different requested directory. Profile cwd, CLI,
fork and tool restrictions stay unchanged. The installed extension runner's
`ExtensionContext.cwd` getter returns its runtime working directory.

The `cwd-same` facade regression failed before the fix and passed afterward.
`cwd-relative`, `cwd-symlink` and `cwd-different` exercise real CLI tool calls;
the last checks refusal before any native delegate call, then a successful
same-directory retry. These controlled-host tests do not prove live T3 behavior.

## Exercise shipped session modes

The shipped profiles use `session-mode: lineage-only`. Standalone-only fixtures
missed an adapter check that rejected those profiles at both launch and completed
resume. Upstream `session.ts:seedSubagentSessionFile` defines lineage-only as a
parent session link with no copied turns. Native T3 represents that relationship
with its authenticated `parentThreadId` and exact adapter binding, rather than a
Pi `parentSession` header. Fork mode still refuses.

`resume-shipped` copies the repository's scout profile unchanged. Its RED run
returned `inherited/forked native sessions are unsupported`; GREEN covers initial
launch and completed same-thread reassignment. It checks the parent/child binding,
absence of parent-only conversation in child provider input and saved history,
profile tool restrictions, and refusal of explicit fork before native delegation.
The controlled host supplies the authenticated parent link. A fresh actual-host
probe is still needed; retained roots can cache an older adapter module.

## Test the client's actual sequence

T3 0.1.7 starts a fresh RPC process and resumes with `switch_session`, then reads
state/entries and updates model, thinking and name before sending an id-less
prompt. A CLI `--session` test alone missed this path. The guard's deferred fresh
reload could acknowledge metadata updates in the retiring runtime while its
replacement used old values. Early input could also disappear.

A test waiter polling every 10 ms accidentally separated requests enough to hide
this race. Use event-driven RPC response handling without artificial inter-command
delays. Assert provider inputs, runtime metadata and history, not ACKs alone.

`input` does not cover registered commands or metadata operations; hook errors
can be logged and ignored. `before_agent_start` follows automatic compaction.
`session_before_switch` runs before target loading, but lacks rollback notification
if a later extension vetoes or opening/validating the target fails. Acquiring a
second ownership lease there would need cleanup the API does not provide.

The repo-owned native patch adds a client-neutral `rpc_ready` boundary and explicit
capability. Preserve request identity and dispatch once; failures must reject the
original request. Read-only discovery must remain possible while child membership
is pending. UI replies and cancellation must remain serviceable. Native edits are
version/hash checked, including bundled execution; unsupported `--t3` launches
must refuse rather than omit enforcement. This revises the earlier extension-only
lifecycle scope, not the lease protocol itself.

## Native children need an admission protocol

T3's existing `delegate_task` returns exact child/task IDs asynchronously without
waiting for child RPC readiness. Parent and child can race. Bind the locally
resolved profile to those IDs; never grant membership from task/role prose.
Authenticate the child's current/parent thread identity through its own T3 MCP
session. Keep saved-session ownership separate from team admission.

Native initialization includes `get_entries`, `set_model`, thinking and name
updates. A fixture that omitted these passed while the actual T3 child failed.
Permit the real initialization sequence without granting inference, compaction or
cache-warming permission before admission. Validate the first provider's profile
and tool list and execution-time restrictions, not only `setActiveTools`.

Nested `executeTool` preserves hooks and validation. Authorize native delegation
only for the exact active wrapper's `parentToolCallId`, not every nested call.
Native validation errors need sanitized actionable details. A generic "delegation
failed" concealed a real `model_unavailable` response. Confirm T3's actual provider
catalogue advertises the selected model; never silently drop the override.

## Observing completion can consume it

T3 `task_status` is not a neutral background probe. Its terminal-result path
acknowledges completion delivery, even if a model has not seen the result. A
fixture originally omitted that side effect. A counterfactual then reproduced the
lost parent notification.

In inspected T3 0.1.7:

- Child-authenticated self `t3_thread_read` avoids the direct-child acknowledgement
  path. Parent reads of a terminal child's output can acknowledge it.
- `t3_thread_wait` observes without acknowledgement or revival, but can follow a
  restart continuation. Check the returned run ID against the authorized binding.
- Model-visible result consumption and background observation are different.
  Native completion can inline results or require `task_status` for larger output.

Keep authentication tokens process-local and out of bindings, errors and logs.
Do not call an endpoint read-only based on its name or annotation alone.

## Contact a verified existing T3 helper

A live coordination check found the matching Pi helper through local metadata,
then `thread send ... --json --wait` returned its acknowledgement and confirmed
Pi session identity. `thread list --project "$PWD"` excluded children, and a Pi
session UUID was not the native T3 thread ID. A known, verified T3 ID needs no SQL.
This is an explicit contact procedure, not a replacement for subagent messaging.

Discover the installed CLI without installing or starting another backend:

```bash
apps=()
for app in /Applications/'T3 Code'*.app "$HOME"/Applications/'T3 Code'*.app; do
  [[ -d "$app" ]] && apps+=("$app")
done
[[ ${#apps[@]} == 1 ]] || { echo 'Select the active T3 app explicitly' >&2; exit 1; }
app=${apps[0]}
exe=$(plutil -extract CFBundleExecutable raw "$app/Contents/Info.plist") || exit 1
t3() {
  ELECTRON_RUN_AS_NODE=1 "$app/Contents/MacOS/$exe" \
    "$app/Contents/Resources/app.asar/apps/server/dist/bin.mjs" "$@"
}
```

If only a Pi UUID is known, use the schema-dependent metadata fallback below.
Set `uuid` to that UUID and `base` to the active backend's configuration base
before running it. The default base is `$HOME/.t3`; a custom `--base-dir` must
match both database discovery and CLI invocation. Check that installed CLI's
help for option placement. This fallback is not a new public API.

```bash
base=${base:-"$HOME/.t3"}
[[ ${uuid:-} =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] || exit 1
rows=$(sqlite3 -readonly -json "$base/userdata/statev2.sqlite" "
SELECT DISTINCT ptt.thread_id, p.workspace_root, ptt.provider,
 json_extract(ptt.payload_json, '$.nativeThreadRef.nativeId') AS native_id,
 ptt.status
FROM orchestration_v2_projection_provider_threads ptt
JOIN orchestration_v2_projection_threads t ON t.thread_id = ptt.thread_id
JOIN projection_projects p ON p.project_id = t.project_id
WHERE ptt.thread_id = '$uuid' OR ptt.provider_session_id = '$uuid'
 OR instr(json_extract(ptt.payload_json, '$.nativeThreadRef.nativeId'), '$uuid') > 0;") || exit 1
repo=$(pwd -P)
thread=$(jq -er --arg repo "$repo" '
  if length == 1 and .[0].workspace_root == $repo and .[0].provider == "pi"
  then .[0].thread_id else error("Ambiguous or mismatched helper") end
' <<< "${rows:-[]}") || exit 1
[[ -n "$thread" ]] || exit 1
# Inspect only these metadata fields; confirm native_id and status before sending.
printf '%s\n' "$rows" | jq .
# After identity confirmation, with CLI base-dir routing matched if customized:
t3 thread send "$thread" 'Bounded coordination request; please acknowledge.' --json --wait
```

The Pi UUID can be embedded in a session filepath inside `native_id`, hence
`instr` rather than bare equality. Refuse ambiguous matches or unexpected repo
or provider; never choose the first row blindly. Keep IDs and metadata local,
without printing tokens, discovery secrets or broad histories. Do not use native
CLI `show`/`read` for discovery: reading child output can consume completion.
`thread send` queues work rather than interrupting the current turn. `--wait`
deliberately reads this new run's reply when an acknowledgement is wanted.
Source references are T3 migration 055, the provider-pi adapter and
`cli/thread.ts`; app discovery follows `pi/test-t3-runtime.sh`.

## Settlement and process lifetime differ

T3 retains idle Pi processes after task completion. Shutdown-only retirement lets
late peer messages revive completed work. Conversely, a coordinator waiting on
candidates is not finished when its model first returns.

Pi's `agent_before_settle` can hold the original run while real steering queues.
`continue:true` causes inference; it is not a keepalive. The low-level agent's
signal can already be absent during this boundary, so an infinite hook can prevent
abort from finishing. The native patch supplies a boundary-lifetime signal and
truthful `agent_settled.aborted` metadata. Tests must cover cancellation without
another provider request and a later successful run without stale abort state.

Use TeamStore's transaction lock to order sending against quiet retirement.
Never await the child's own T3 terminal status inside its `agent_settled` handler:
Pi publishes the RPC settlement only after that handler returns. Keep T3 as the
native process owner; do not send our descendant signals to its children or borrow
`PI_LIFECYCLE_OWNER` from their parent. Preserve arena's messaging suspension while
native completion steering advances its phases.

Command-context tool execution must work on empty history through the existing
validation/permission pipeline. Do not invent an assistant message to satisfy a
nested-tool helper. Command authority closes on completion, abort and replacement.
Private candidate copying must include patched agent-core type assets rather than
writing through a `node_modules` symlink into the active installation.

## Actual-host tests and limits

`pi/test-t3-runtime.sh` runs the installed Electron/ASAR backend unchanged with a
private HOME/data directory and scripted loopback provider. Run `project add`
before the backend acquires its server lock. A listening port is not sufficient
readiness; native CLI discovery also needs its private runtime-state file.
Provider advertisement must be ready before delegation.

The backend prints pairing credentials even with `--no-browser`. Discard its
console streams; do not copy tokens into reports. Native CLI inspection can itself
acknowledge child output, so verify parent-model delivery before inspecting a
terminal child through parent-scoped APIs.

Relevant tests:

- `pi/test-rpc-readiness.sh`: actual bundled CLI, ownership/metadata ordering,
  admission, cancellation, command tools and settlement.
- `pi/test-t3-adapter.sh`: controlled host contract and negative controls. It is
  not actual T3 proof.
- `pi/test-t3-runtime.sh`: installed T3 backend and real Pi input/output path.
- `pi/test-command.sh`, `pi/test-launch-args.sh`: opt-in routing, native runtime
  checks, argument boundaries and the actual extension-disabled offline fork.

T3's fork helper passes launch flags while disabling extensions. Our launcher
removes only its extension flags for that offline metadata-fork case, preserving
normal/discovery arguments and explicit extensions. Headless bootstrap skips
terminal configuration. An unpatched RPC helper can retain its loop after stdin
EOF; the fork test uses the host's termination behavior after checking its result.

The actual-host leaf checkpoint passed native child creation, first-request
profile restrictions, ping/reply/root audit, native completion reaching the parent
model, and rejection of a late DM while T3 retained the child's Pi process.
The parent reran this checkpoint independently. Cleanup preserved an unrelated
sentinel. This used scripted models through the real backend, not live inference.

The actual-host arena checkpoint also passed deterministic launch, two candidates,
cross-judge, synthesis, artifact verification and saved OFF restoration. The parent
reran it and native full STOP independently. STOP closed held provider requests,
interrupted native root/child runs, restored saved mode and left an unrelated thread
usable. A Stop acknowledgement alone did not count as termination.

Real `pi.sh` baseline, leaf and arena checkpoints use a private copied repository,
verified local upstream archive and copied executable dependencies. The parent
reran the launcher leaf. Kernel checks deny non-loopback networking and unrelated
writes; documented exceptions allow verified `/bin/ps` and Bash heredoc temporary
files. No writable dependency symlinks may escape the fixture.

Actual-host question/answer and steering passed with team OFF. Permission-request
isolation refused a genuine confirmation request without approving it. Same-thread
reassignment retained the child PID, canonical history and private context while
creating new task/run/member identities. The parent reran these paths, including
resume and arena on the final review-fix candidate.

High review fixed rejected admission caches, failed-launch cleanup, redundant
state reads and unused state. Parent reruns covered all six targeted fix cases.
Deployment succeeded after the installer Git-context correction described in the
RPC readiness lessons; the installed readiness check and adapter byte identity
passed. No T3 files or user settings changed.

The evidence is macOS with Pi 1.0.4 and T3 0.1.7. Actual GUI behavior, actual-host
replaced-process resume and concurrent `/arena cancel` remain unverified.
No fixture report, cached screenshot or successful parent-only round trip proves
native child team compatibility.

A subsequent live-host probe used the unchanged shipped reviewer profile and an
explicit matching cwd. Native launch succeeded, the child returned the exact
probe marker, and the parent consumed a successful terminal result with matching
task/thread/run IDs. This caught gaps that standalone fixture profiles missed.
A retained process can still hold the old adapter after deployment; a fresh
labelled diagnostic thread verified the new code without restarting user work.
The native CLI's `--wait` initially returned after the parent said it was waiting;
child completion arrived in a later parent run. Verify that later result and its
actual tool record, not merely the first completed-run receipt.

## Check the observation before changing production

Actual `tool_result` events include validated `input` and can carry the original
MCP envelope in `structuredContent`. Saved transcript results omit those fields.
Do not derive event decoding from saved results. The adapter parser needed an
actual-shaped regression; later private instrumentation proved exact result IDs
matched and consumption updated correctly.

The host fixture had separate errors. It rejected legitimate root inference after
deterministic arena launch, failed to advance on result-consumption corrections,
and counted one task twice under scoped member names and native display titles.
Use exact task/thread/run tuples for identity. Assert no parent inference before
coordinator creation, while permitting genuine later native completion wakes.
Record fresh correction issuance rather than counting historical prompt copies.
Preserve failed evidence and distinguish a diagnostic success from a full test pass.

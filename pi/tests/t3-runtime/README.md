# Installed T3 runtime proof

Run from the repository, without installing anything:

```bash
bash pi/test-t3-runtime.sh
bash pi/test-t3-runtime.sh --app "$T3_APP" --pi-cli "$CANDIDATE_PI_CLI" --agent-settings "$PRIVATE_AGENT_SETTINGS"
```

`--app` selects an installed macOS app bundle. Otherwise the script discovers a T3 Code bundle in the standard application directories. It reads CFBundleExecutable and runs the bundled native CLI with ELECTRON_RUN_AS_NODE. `--pi-cli` defaults to the installed Pi executable resolved through `pi/command-path.sh`. A candidate package is supported through its executable CLI entry point, not a separate package-install interface.

`--launch-args` sets the private T3 provider's Pi launch arguments. It defaults to `--offline`; candidate integration can supply `--launch-args '--offline --t3 --team'`. It does not alter the installed app or candidate CLI.

`--agent-settings` copies a supplied JSON file into the private agent directory. Use absolute extension/package paths in that file. Supply only trusted, credential-free candidate settings; loaded extensions can run arbitrary code. The script does not copy user settings, credentials, sessions or installed extensions. The baseline uses real Pi with minimal private settings, without a lifecycle extension or custom readiness flags. Pass candidate lifecycle/adapter settings for the leaf integration scenario below.

The script prints its private `mktemp` evidence directory. It keeps CLI output, `provider.jsonl`, `backend.json`, `listen.txt`, `pi-pids.txt`, and `proof.json`. The provider file contains synthetic task messages and the model request, not HTTP headers. Native `serve` prints pairing credentials and a QR code, so both backend output streams are discarded, including failure diagnostics. No tokens are read or copied by the test. T3's native CLI manages private MCP authentication in private state. Treat the entire evidence directory as private and do not commit it.

## Assertions

The installed native CLI must complete `--version` and `--help`, add a project, start a thread with `fixturePi` and `fixture/fixture`, list/show the thread, and send a follow-up. The unchanged backend launches actual Pi RPC through the private launcher. The loopback SSE model must receive each unique task exactly as supplied, and native `thread show` must expose each exact scripted reply. The test records the backend PID and checks its listening socket with `lsof`.

Cleanup checks that the backend and recorded Pi processes stopped and that an unrelated sentinel stayed alive. The sentinel is then stopped. Failed cleanup fails the test, and recorded surviving Pi processes receive SIGKILL. This is not a general descendant-process audit. Abrupt termination of the test driver itself is not covered.

## Native leaf integration

```bash
bash pi/test-t3-runtime.sh --pi-cli "$CANDIDATE_PI_CLI" \
  --agent-settings "$PRIVATE_AGENT_SETTINGS" \
  --leaf-profile "$PRIVATE_LEAF_PROFILE" --launch-args '--offline --t3 --team'
```

The profile must be named `proof-leaf`, include `BOUND_LEAF_PROFILE` in its system prompt, and allow `read`. The test copies it into private agent state and selects the `leaf` scenario instead of the baseline follow-up. Only private T3 settings receive `defaultRuntimeMode: full-access`. Native `thread start` has no runtime-mode flag; its MCP authentication ceiling does not itself set the thread mode.

The root model calls `subagent({agent:'proof-leaf', name:'proof-leaf', task:'CHILD_NATIVE_TASK'})`. A real native child must receive that exact task and expose only the profile's allowed tools. The child calls `team_send` with `PEER_PING` and waits for `PEER_REPLY`; the root replies with the exact ping message ID. Both messages must appear in the root audit. The root model must then receive native T3's `[completed]` notification containing `CHILD_NATIVE_RESULT`, attempt a rejected post-completion DM, and produce the exact final reply visible through the CLI. The completed child's actual PID must still be alive but its team membership must be undeliverable before cleanup.

No native MCP endpoint is mocked. The test never reads the child thread through a parent T3 tool, avoiding acknowledgement of its completion before native delivery. It observes the root's real model input and private team audit instead. This scenario does not exercise arena/coordinator behavior.

## Native CLI observations

- Run `project add` before starting the backend. In this installed CLI, project mutation acquires the server ownership lock directly and refuses while a backend owns it. `project add` has no `--json` flag.
- A listening socket is too early for `thread start`. Wait for the private `userdata/server-runtime.json` file as well. The CLI uses persisted runtime discovery; a socket-only check produced “No running T3 Code server”. The test checks file existence without reading its contents.
- Native delegation validates explicit models against provider discovery. Wait for the real private provider cache to advertise `fixture/fixture` before starting the root. A snapshot is saved in `provider-discovery.json`; a listening backend and successful root inference alone do not establish catalogue readiness.
- Native child startup calls `get_entries`, `set_model` and related metadata RPCs before inference. An adapter that rejects all non-inference child calls prevents the turn from starting. Private `server.trace.ndjson` and Pi session `nestedCalls` preserve the underlying error; the root's generic provider-start failure does not identify it.
- `serve` emits a pairing token, URL and QR code by default. Do not capture backend console output, even with `--no-browser`.

## Limits

This test requires macOS, an installed T3 app, Node, jq, Bash and lsof. The Bash entry point targets Bash 3.2; Node is used for native-process orchestration and the concurrent SSE endpoint. The baseline does not prove adapter behavior. The leaf scenario covers the specific native-child exchange above, not general team ownership. Neither scenario proves Linux, GUI rendering, cancellation, denial, images, failure recovery, arena/coordinator behavior, or external-network isolation. The environment is allowlisted and application state is private, but this is not an OS network sandbox. Provider requests go to loopback. There is a small ephemeral-port reservation/rebind race; binding or discovery failure fails the run rather than selecting an existing server.

The integration owner runs the final high-effort code review across all changes.

## Same-thread history reassignment

`--resume --launch-args '--offline --t3 --team'` requires a candidate implementing native same-thread reassignment. The first child receives a private generated marker, asks a native parent question, and completes without disclosing that marker in its final response. After the first root run completes, the public CLI sends a new parent request, forcing a real parent native-run transition. A late peer DM and stale answer must refuse before the parent explicitly calls `subagent_message` with a vague follow-up that does not repeat the marker.

Success requires the same child thread and prior user/assistant history, exactly one follow-up inference, and new task/run/member-incarnation identities. A fresh child is not an acceptable substitute. The first provider PID must still be alive before reassignment. The safe controls-only checkpoint is expected RED: it explicitly refuses pending same-thread rebind rather than starting a fresh-context replacement. Replaced-provider coverage requires an existing public lifecycle route and is not simulated by killing a process.

## Native live controls and permission isolation

Use `--controls --launch-args '--offline --t3'` with a controls-capable frozen candidate/settings pair. A real child asks `ask_question`; its parent answers through `subagent_message` using the exact native request ID from parent context. The child then receives live steering through the same facade without a request ID. A provider barrier waits for the actual steering tool receipt, not a timing guess. Team state must remain OFF throughout. After native child completion, an answer using the old request ID must refuse without a new child, another child inference, or reopening the resolved native user-input request.

`--permission-refusal` is a separate direct-candidate case. Its private child profile explicitly grants `fixture_approval_write`, a test-only tool that calls real `ctx.ui.confirm` before a harmless workspace write. The test reads only saved synthetic orchestration events to establish that the live directly owned child has a `kind: command`, `type: approval_request` request. The parent attempts that exact ID through `subagent_message`. The request must remain pending, the write absent, and child inference blocked. A separate real control thread then cancels through public full STOP; the native permission request must become cancelled, never approved. The already-completed parent may remain completed while its blocked child becomes interrupted.

This proves native confirmation-request-kind isolation, not automatic approval-required policy. Under approval-required policy the parent `subagent` call itself requests approval before a child can be created; that blocked ordering case was preserved without approving it. No auth tables, token files, direct UI-response injection, or fake MCP transport are used. The permission case is intentionally refused with `--launcher-fixture` until its private probe is included in that deployment path. Actual question handling during arena suspension and completed-history reassignment require separate checkpoints.

## Native arena checkpoint

Use `--arena --launch-args '--offline --t3 --team'` or `--arena-off --launch-args '--offline --t3'` with a coherent candidate CLI/settings pair. The test installs private phase profiles and an arena skill. Native CLI `thread start` receives `/arena ARENA_REQUEST` directly. No root inference may precede coordinator creation. A real native completion wake may invoke the root model afterward; rejecting that legitimate inference makes the fixture fail its own host run.

Two candidates write independent artifacts. The coordinator reads their results, launches a read-only cross-judge, writes a synthesis with rationale, and executes a Bash check of the artifact. Checks require successful persisted tool results, exactly three consumed candidate/judge results, a finished command outcome, native root status `completed`, the exact visible root reply, and restored saved messaging state. Native task/thread/run tuples identify completions; scoped member names and notification titles are only display aliases. The fixture obeys concrete owned-result consumption corrections and can advance from terminal `task_status` results even when acknowledgement suppresses a pending notification.

Passing a single checkpoint is not a stability claim. `--arena-dropout` makes candidate-b's actual provider request return HTTP 400. The native failed result must be consumed, the judge must read only the surviving artifact, and synthesis must disclose the dropout while still passing its artifact check and restoring messaging.

`--arena-cancel` holds both actual candidate provider requests at deterministic barriers. Only then does the public CLI launch a second real Pi control thread using a separate private provider instance without `--t3`. Its model calls `mcp__t3-code__t3_thread_interrupt` with the exact arena root ID and `stop:true`. The adapter's own control-tool restrictions remain unchanged. The test requires native terminal root/child statuses, closed provider requests, zero subsequent target inference through the control checks, restored suspension, and non-live/non-deliverable child memberships. An unrelated real thread must still complete a new turn. No test-side child signal causes the cancellation; ordinary backend teardown happens after verification.

The control tool's `interrupt_requested` response is only an acknowledgement. Native CLI thread state proves termination. Local observer status can remain `running` or `unknown` after native shutdown, so the evidence distinguishes that observation from native terminal status and the membership fence. This proves native full STOP, not concurrent invocation of the `/arena cancel` command. It does not actively send a late peer DM from a cancelled root. Preserve failed evidence rather than relabeling it after a fix.

## Real launcher, offline bootstrap

Preparation requires a frozen checkpoint containing `package/` and `interactive-subagents.patch`, the frozen independently selected candidate package, and the original pinned upstream archive. No archive is downloaded:

```bash
bash pi/tests/t3-runtime/prepare-launcher.sh "$PWD" "$CHECKPOINT" \
  "$CANDIDATE_PACKAGE" "$ORIGINAL_ARCHIVE" "$NEW_FIXTURE_DIR"
bash pi/test-t3-runtime.sh --launcher-fixture "$NEW_FIXTURE_DIR" --launch-args '--offline'
bash pi/test-t3-runtime.sh --launcher-fixture "$NEW_FIXTURE_DIR" \
  --leaf-profile "$PRIVATE_LEAF_PROFILE" --launch-args '--offline --t3 --team'
```

Preparation verifies the archive SHA from `upstream.json`, checks source/dependency hashes before and after copying, and rejects escaping symlinks in mutable trees. It deep-copies the original repository fallback without upgrading its pinned version. A separate private candidate goes on PATH, with `CONFIG_PI_HOME` unset. The private readiness helper must accept that candidate unchanged. Only private fixture settings/models/profiles differ from ordinary deployment.

The unchanged updater receives the exact SHA-verified archive through a local-only curl transport, applies the frozen patch, and generates its own source stamp. Unexpected fetch URLs or package-manager calls fail. The unchanged setup still executes Playwright's installer against copied, revision-matched executable distributions. Browser profiles, credentials, user sessions, and preferences are not copied.

A macOS kernel sandbox denies non-loopback network and writes outside fixture storage. Two documented exceptions are required: the signature-verified, hash-checked `/bin/ps` runs outside the sandbox for read-only PID inspection; Bash 3.2 receives directory access plus writes only matching `/private/var/tmp/sh-thd-[0-9]+`. Every run proves a synthetic heredoc works, an unrelated OS-temp write is denied, and a non-loopback connection fails with `EPERM`. Pi, bootstrap, and network-capable processes remain sandboxed. Do not describe this as every process being sandboxed.

T3 reconstructs provider PATH with system entries first. The private launcher pins fixture infrastructure ahead of that PATH, without altering the actual `pi.sh`. Bootstrap also redeploys `models.json`, so the loopback model must be supplied at the private repository source as well as the private agent directory. The real launcher executes for provider discovery, root, and native child. A read-only private startup extension records actual CLI/Node paths and PIDs; stdout/RPC is not intercepted or rewritten. Evidence includes source/dependency manifests, local transport receipts, `launcher-environment.txt`, `runtime-processes.jsonl`, filesystem/network refusals, and before/after original asset, T3, and ps hashes.

Launcher checkpoints cover baseline, leaf, and normal arena behavior, including concurrent candidate bootstraps. Dropout and full STOP checkpoints use the direct candidate CLI unless `--launcher-fixture` is explicitly supplied. This is not exhaustive concurrency proof. No setup lock or serialization is added by the fixture.

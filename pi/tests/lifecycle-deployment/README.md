# Isolated deployment checkpoint

Run `bash pi/test-lifecycle-deployment.sh`. It prints a retained proof directory, copies the repository and existing dependencies, then runs the real `init.sh --pi-no-terminal` with private HOME, Pi home, runtime, browser cache, npm cache and temporary files. It refuses missing host prerequisites and blocks host package installers. No credentials or live sessions are copied.

The deployment assertion is intentionally RED when settings only copy the guard without activating it. Snippet verification still runs: it imports the deployed symlink through Jiti, opens the real picker, selects scope-creep and research-escape-hatch, and checks both exact bodies appended in order and the one-shot reset. The UI host is a test double. This direct Jiti check is separate from the actual CLI check in the owned runtime scenario: Ctrl+R opens the picker, both snippets are selected with terminal input, and the synthetic provider must receive both exact deployed bodies appended to the submitted text.

## Private activation candidate

Wait for the parent's core startup-prompt fix and team integration checkpoint before taking the next snapshot. Do not activate the authoritative repository setting to run this proof: ordinary `pi.sh` launches automatically deploy repository settings.

Make a disposable repository copy with private copies of dependencies, then change only this line in that copy's `pi/agent/settings.json`:

```diff
-  "extensions": ["-builtin:mcp"],
+  "extensions": ["./lifecycle/session-lifecycle.ts", "-builtin:mcp"],
```

Retain the original settings alongside the candidate, record the exact one-line diff, and hash both settings files. Run `bash pi/test-lifecycle-deployment.sh` from that candidate repository. Its existing proof script takes another private snapshot and invokes the actual init script. Do not patch generated `deployed-settings.json` or the deployed guard setting to make the activation assertion pass. Retain the candidate diff and hashes alongside the printed proof directory so the proposed input and deployed result can be compared.

Run the printed `--runtime PROOF_DIRECTORY` command against that completed private deployment. The private adapter removes only the lab's `--no-extensions`, points it at a copy of the deployed agent, and selects the existing loopback provider. It does not inject the guard or replace the default packages. The lab retains ownership receipts and performs bounded cleanup. Authoritative activation waits until the MVP and reviews pass.

The runtime check adds an admission-bus witness after the configured guard and before package consumers. It requires pending admission at factory time, owned admission on session start, a live actual team registration, and a normal echoed chat. A separate private lab forces guard initialization failure and requires a visible unprotected warning, denied admission, ordinary chat, and no team state. These checks are not claimed as passing until run against a completed candidate. The adapter passes the controller's exact `--version` probe through before requiring lab models; normal launches retain the private-lab checks. Paths are resolved physically to avoid macOS `/var` versus `/private/var` entry-point mismatches.

For fast retries, retain a failed `runtime-owned` or `runtime-unprotected` directory under another name, copy only changed test files into the candidate, and record their hashes separately. Then run `bash "$PROOF/repo/pi/tests/lifecycle-deployment/runtime.sh" "$PROOF" owned` or `unprotected`. Do not rerun setup for a controller or assertion-only change. Product-source changes require a recorded candidate update and isolated init.

The targeted persisted failure-policy check is `bash pi/tests/lifecycle-deployment/persisted-failure.sh "$PROOF" "$FROZEN_AGENT" print` or `rpc`. It copies the explicit frozen agent input into a fresh case, obstructs `.pi-lifecycle`, and requires a warning, a diagnostic for that session, the exact task reply, and exactly one model request with no injected investigation. It never disables the guard. The original print RED is retained in `persisted-print-failure.5F71SZ9x` under the proof directory; its `agent` directory is a reusable failing input. Run revised-core cases only after the producer marks the change ready.

Evidence includes `input-sha256.txt`, `cli.json`, `cli-version.txt`, `cli-runtime-sha256.txt`, `setup.log`, `deployed-settings.json`, `activation.txt`, and `snippets.log`. Runtime runs retain `runtime-*/lab.json`, screenshots as terminal text, saved messages, admission receipts, team state, launcher arguments and cleanup status. These artifacts are outside the repository.

Snapshotting is not an atomic snapshot of other writers. If setup rejects a patch captured during editing, retain its log and hashes as a failed preparation. Do not repair that snapshot or claim it tested a finished candidate. Reprepare only when the parent says inputs are complete. Node's loopback provider guard is not an OS sandbox. Only trusted repository extensions belong in this test.

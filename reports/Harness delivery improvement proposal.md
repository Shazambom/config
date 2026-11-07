# Harness delivery improvement proposal

**Status: first slice approved, implemented, reviewed and deployed.** Parent verification: `$TMPDIR/pi-delivery.ggbwuu/`; actual checked-delivery receipt: `$TMPDIR/pi-delivery-installed.XmEAse/receipt.json`. Runtime behavior remains explicitly unchecked in the deployment receipt; the separate isolated Bash-tool proof is recorded in the test evidence. The text below preserves the approved design. Arena: two `openai-codex/gpt-6-astra` and two `openai-codex/gpt-6.1-sol` candidates, followed by a fresh Sol cross-judge. The parent read every candidate. Both selected candidate 4 as the base, but rejected two weaknesses shared by all candidates: accumulating files on every Pi launch and treating stderr as proof the user received a notice.

## Recommended first change

Add an **explicit checked Pi-deployment operation**, using existing setup and verification. It records what happened and returns a failed operation when its required artifact check fails—even if setup itself exited zero. It does not claim that static checks establish running behavior.

Proposed interface, not an existing command:

```bash
./init.sh --pi-delivery <new-receipt-path>
```

This is an explicit Pi-only operation, without terminal reconfiguration. Ordinary `pi.sh`, `init.sh --pi`, and `init.sh --pi-no-terminal` retain their current behavior. The new operation is for deliberate delivery verification, not every startup. No new environment variables, dependencies, background services, tool-blocking policy, or native Pi/T3 patch.

This is intentionally **not a complete fix for all four complaints**. It makes one delivery failure mechanically harder to misreport and preserves its evidence. Scope judgment, arbitrary test validity and general worker recovery remain outside this code slice. Approve that boundary before implementation.

## Verified existing behavior

- `pi.sh:11-15` invokes setup on every launch, including headless paths. Automatically retaining a new receipt each time would create unbounded routine artifacts.
- `pi/setup.sh:20-34` selects the runtime and permits RPC patch failure with a warning. This preserves ordinary terminal compatibility. `init.sh` subsequently prints `Pi setup complete.`
- `pi/rpc-readiness.sh` already validates version, package identity, symlinks and pinned original/patched hashes. Its existing `--check` does not install anything. There is no need for a second manifest or hash verifier.
- `pi.sh:35-43` already refuses unsupported opt-in T3 launches. Do not make optional RPC support fatal for ordinary startup.
- The discovered installed Pi 1.0.4 `dist/core/tools/bash.js:281-305` exposes `exit_code` and returns `isError: true` for nonzero exits. That gives the explicit delivery command an existing tool-level failure channel. This is source verification, not a fresh UI test or proof a person read the result.
- Applied subagent `tmux.ts:306-397` already observes per-launch exit receipts and treats uncertain disappearance conservatively. Those receipts concern the child Pi launch, not every command inside it. T3 instead uses exact task/thread/run identities and has completion-consumption semantics.

The installation incident itself was fixed earlier. This proposal prevents its zero-exit/warning combination from masquerading as a successful *checked delivery*. It does not repair the already-fixed Git-context bug again.

## Concrete implementation shape

All new names and flags below are proposed.

1. **`init.sh`: explicit dispatch.** Accept the new operation and receipt destination. Reuse existing Node/jq bootstrap before invoking `pi/delivery.sh`. Keep ordinary launch paths untouched. This command deploys only Pi configuration and checks its RPC patch assets; it does not configure terminals or Neovim.
2. **`pi/delivery.sh`: small subprocess wrapper.** Reserve a new receipt destination without overwriting existing evidence, then run `pi/setup.sh` as a separate foreground Bash process. Preserve the child's own `set -e` behavior rather than placing its body inside an `if`-tested function. Record the actual setup exit before doing more work.
3. **`pi/setup.sh`: minimal identity handoff.** In this explicit mode only, publish the runtime selection it actually used through a private invocation-local handoff. Do not rediscover a potentially different executable afterward. If setup fails before selection, report the artifact check as unknown/not run. Existing callers remain valid. This handoff must not dump environment, credentials or whole setup logs.
4. **`pi/rpc-readiness.sh`: structured diagnostics.** Extend the existing read-only checker with a small structured-output mode using its current validation branches and manifest. Recognized absent/mixed/mismatched assets are a failed check; inability to perform or interpret the observation is unknown. Do not parse English warnings or duplicate the hash allowlist.
5. **Finish the observation.** Verify the selected package after setup, atomically finalize the receipt, and print a concise summary at the end of command output. A failed setup, failed/unknown required check, or inability to publish the receipt makes this explicit operation fail. Preserve the original setup exit in the record. Ordinary startup's warning policy does not change.

A successful explicit command means only: **setup succeeded and the selected RPC assets passed their static check**. Its summary must still say `entry point: not run; behavior: not run`. It must not say `feature ready`.

### Receipt and storage boundary

One caller-selected JSON destination per deliberate operation. Refuse an existing destination rather than silently overwrite it or select a previous successful report. No automatic archive, `latest` pointer, status database, status-reader command or retention daemon. Temporary handoff/check files are private and removed when possible; interruption may leave private temporary evidence, never a success claim.

Keep the receipt small: operation identity and timestamps; observed command exit; exact selected package/version; checker/manifest identity and relevant observed asset identity; artifact-check state/reason; entry-point and behavior states; bounded checker diagnostics. Initial state is **completion not observed**, not an assertion that a process is currently alive. Same-directory atomic publication prevents partial JSON; it is not a power-loss or hostile-same-user guarantee.

A later runtime test produces separate evidence tied to the observed artifact, rather than rewriting an old static receipt into success. The caller owns retention of explicitly requested reports. Routine launch file count must not grow because of this feature.

### Presentation and cancellation limits

The supported first presentation route is direct command output and Pi's existing Bash tool result. A nonzero result is mechanically distinguishable from setup exit zero; stdout/stderr can still be hidden by a caller. No claim of a desktop notification, T3 GUI delivery, user acknowledgment, or an unavoidable model final-answer correction.

Keep setup as an owned foreground subprocess under the existing shell execution route. On cancellation, preserve interrupted/unknown status and do not retry. Validate actual signal behavior in an isolated test before claiming cleanup; do not kill unrelated processes or infer that every descendant stopped. General process supervision is not added here.

## Accounting for all four complaint items

| Item | Proposed action now | Not claimed or included |
|---|---|---|
| Delivery status | Checked operation, structured evidence, failed check becomes failed operation, no aggregate readiness claim | Universal delivery inference, automatic behavior testing, guaranteed GUI notice |
| Scope drift | Use the existing approved-plan/conversation checkpoint; keep reviewer additions outside the approved acceptance criteria | Semantic scope detector, immutable agent-proof approval store, tool firewall |
| Misleading observations | Identify artifact and observer; calibrate the selected check with good/bad/broken-observer controls | Proving arbitrary agent-written tests correct or equating fixtures with live behavior |
| Interrupted workers | Preserve this deployment's observation; reconcile existing launch receipts and authoritative process/task identity before retrying | Durable worker adoption, automatic retries, recovery of arbitrary internal commands, exactly-once execution |

No code change is yet justified for the latter three beyond applying these boundaries to the proposed operation. If you require technical controls for those items in this delivery, this MVP is insufficient; choose that scope explicitly rather than smuggling it into the receipt work.

## RED/GREEN and proof plan — not run

1. **RED:** through a disposable real `init.sh` route, make setup exit zero after a controlled RPC-patch refusal, leaving recognized unpatched assets. The explicit operation must fail, retain `setup_exit=0`, report failed assets, and keep behavior unchecked. Missing receipt behavior must fail the test before implementation.
2. **GREEN:** add the smallest wrapper/integration/structured output changes and rerun the unchanged test. A known-good package passes only the static fields.
3. **Negative controls:** old/mixed package; wrong global-versus-fallback selection; failure before selection; corrupt observer output; unwritable/existing receipt; interrupted setup; and an old successful receipt from another invocation. None can become current readiness or permission to retry.
4. **Observation calibration:** disabling the protected artifact check must fail the acceptance test. Breaking its decoder must yield unknown/inconclusive, not a diagnosis of product failure.
5. **Presentation:** exercise the new command through the actual isolated installed Pi Bash-tool path with a scripted provider. Assert the nonzero result, structured exit code, readable failure summary and matching receipt. A direct shell-only test is insufficient for the tool-path claim. GUI/human visibility stays unverified unless separately exercised.
6. **Usability/storage:** repeat ordinary launch paths and confirm they produce no delivery receipts or added checks. Test concurrent explicit attempts with different destinations and refusal of a shared/existing destination without overwriting either result.
7. **Bounded actual behavior proof:** if a later claim includes runtime behavior, agree on one harmless fresh challenge through the selected installed entry point with artifact and observer provenance. A copied patched CLI or repository guard is not automatically the deployed runtime/guard. Do not run the full T3 suite merely to make an unchecked field green.

After approval: targeted regressions first, focused independent review, `/diff` checkpoint, then deployment through `init.sh`. No user-session restarts. Roll back only these source changes through the same setup path; preserve requested evidence and unrelated working-tree changes.

## Why these choices

The alternatives were instructions alone, a generic delivery extension, universally fatal setup warnings, and a durable workflow/replay engine. Instructions alone repeat the missed-summary risk. Generic hooks do not know what arbitrary shell commands prove. Universally fatal warnings break the existing terminal compatibility policy. A replay engine expands the problem and cannot make external effects exactly-once.

Fetched primary research behind the candidates:
- [Kubernetes probe distinctions](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/): borrow separated observations, not a monitoring service or restart policy.
- [Anthropic agent evaluations](https://www.anthropic.com/research/demystifying-evals-for-ai-agents): outcomes differ from transcripts; calibrate observers against reference behavior.
- [Temporal activity semantics](https://docs.temporal.io/activity-definition): effects may precede recorded completion; do not blindly replay.

These are design references, not proof this proposal works. All arena work was research/source inspection; no implementation, acceptance tests, deployment or GUI verification was performed.

## Decision requested

Approve or reject this **explicit, installer-specific checked-delivery MVP**, including:
- one caller-selected report, rather than automatic reporting on every launch;
- nonzero status for unavailable required RPC assets only in the new operation;
- command/tool-result presentation, not guaranteed UI notification;
- runtime behavior left explicitly unchecked;
- the other three complaint items remaining procedural/deferred rather than bundled into new infrastructure.

If that boundary is too narrow, name which missing outcome must be included before implementation starts. The complaint is not addressed by producing this plan.

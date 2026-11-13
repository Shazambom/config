# Pi task tracking

The upstream Pi 1.0.4 TODO example returned shallow snapshots and reconstructed
state by reference. Toggling an item changed earlier live session history even
though its saved JSONL snapshot stayed unchanged. The adaptation in
`pi/agent/extensions/todo.ts` copies scalar task objects on reconstruction and
every returned snapshot. Preserve both copy boundaries when modifying it.

`bash pi/test-todo.sh` exercises actual CLI automatic loading with Bash/codemode
defaults, saved and live snapshots, restart, clear/restart, missing-ID handling,
and the existing extension-exclusion setting. Branch rewind and immediate
post-reconstruction mutation use the actual SessionManager SDK. The test uses
synthetic localhost responses, fresh state and no account credentials. It does
not prove interactive tree UI behavior or model adherence.

Tool routing needs separate persistence qualification. In an actual Pi 1.0.4
codemode fixture, a nested TODO add returned success but disappeared after restart.
Reconstruction scans direct `toolResult` messages named `todo`; nested execution
did not create one. The snapshot-fixed source has the same limitation. Default
codemode availability in the existing tests does not prove nested TODO persistence.
Keep TODO calls direct until an approved fix records explicit current-branch state
at mutation time and passes nested-call, restart, legacy-history and rewind tests.
Preserve the copy boundaries and uncertain-toggle handling in that fix. The goals
extension's explicit custom entries survived the same fixture, providing an
existing session-API pattern without a new storage framework.

`toggle` is intentionally not idempotent. Inspect current state before repeating
an uncertain operation. The tool stores progress; it does not verify completion
or automatically resume unfinished work. Root guidance asks for all required
outcomes through verification. A benchmark agent tracked only its build phase
while continuing linking and verification outside the list, motivating that
guidance without establishing a causal improvement in long-task focus.

The existing setup resource-copy path deploys the extension and its license;
no installer or new feature switch is needed. Restricted child profiles use
explicit tool allowlists and do not inherit this tool automatically. Keep their
guidance usable through ordinary progress notes unless separately qualifying a
child-tool rollout. After deployment, compare source and installed files and run
`bash pi/test-todo.sh "$HOME/.pi/agent/extensions/todo.ts"`.

Tracking alone does not choose the next obligation. Observed reporting and
deployment detours motivated the root-focus paragraph in `pi/agent/AGENTS.md`:
prioritize the required deliverable, reuse accepted decisions unless evidence
changes, report available results promptly, and retain unfinished work after a
status question. Required research and verification still belong to the task.
Paired static-task passes establish compatibility, not sustained-focus benefit;
one short case used fewer calls by omitting optional tracking and batching work.
Do not turn that observation into a reason to remove tracking from longer work.
Policy promotion should match the tested bytes and deploy through existing init.

Upstream source: `earendil-works/pi`, `examples/extensions/todo.ts` as distributed
in Pi 1.0.4. MIT attribution is retained in `todo.LICENSE` beside the extension.

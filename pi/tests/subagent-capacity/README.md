# Subagent pane capacity regression

Run `bash pi/test-subagent-capacity.sh`. Requires tmux, the active Pi CLI installation, repository test dependencies, and network access to download the checksum-pinned upstream archive. It does not deploy or use real credentials/models.

To test an already-applied candidate or deployed package without downloading or modifying it, run `bash pi/test-subagent-capacity.sh all /path/to/package-root`. That root must contain `pi-extension/subagents/`. Run `bash pi/tests/subagent-capacity/discovery.sh /path/to/package-root` to verify discovery with an unusable npm command.

The runner preserves its printed temporary directory. `result.log`, `sensitivity.log`, `provider-contexts.json`, and `dispatch.jsonl` contain the evidence. It uses a private tmux socket, private HOME, and a synthetic in-process provider. The SDK comes from the resolved active CLI's package ancestry using `pi/command-path.sh`, not npm's global prefix or the repository's older SDK. Test modules use JavaScript because they exercise the upstream TypeScript module and SDK APIs through Jiti.

Checks cover:

- Nine synchronous module splits in a 180x40 window, with all ten panes live before the event loop can run a layout callback.
- Genuine 1x1 exhaustion through both production tool executors and the installed SDK tool loop. The next provider context must contain `isError: true` and parseable JSON content with the capacity flags and retry guidance.
- Failed requests leave registry, loadout, task-script and team records unchanged. Explicit retries dispatch the exact fresh/resume task once to private no-model actors. Failed default-name reservations are released.
- Invalid panes, an invalid target containing the capacity words, and a missing server remain ordinary errors.
- Handled capacity stderr is not printed separately.
- The same burst test fails when only synchronous creation balancing is disabled.
- The private server and recorded actor PIDs are gone at teardown.

The successful retry actors test command dispatch, not a complete child inference session. SDK callbacks supply synthetic model responses; no HTTP provider is involved. Existing best-effort pane/watcher cleanup can print missing-pane/server diagnostics during teardown. Those are not capacity errors.

## Patch maintenance

No generated repository upstream file is edited. The existing patch had no `tmux.ts` hunk. To produce this addition, copy the pinned applied `tmux.ts` into a private Git directory under `pi-extension/subagents/tmux.ts`, run `git init` and `git add .`, replace that private file with the tested implementation, then append `git diff --unified=0` to `pi/patches/interactive-subagents.patch`. All pre-existing patch bytes remain unchanged. The runner verifies the combined patch applies to a fresh checksum-verified archive.

The RED burst failed with tmux's genuine no-space diagnostic. The structured-response RED failed in the actual production executor. An additional invalid-target RED caught substring matching of stderr; matching is now anchored to the complete known diagnostic. SDK verification also showed that returning `isError` from `execute` is not sufficient in the tested tool loop. Throwing an Error with JSON text preserves both structured provider content and SDK error status without an event hook.

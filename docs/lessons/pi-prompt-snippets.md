# Pi prompt snippets

## Custom snippets vanished from the picker while every file was in place

**What failed.** Ctrl+R listed only the six upstream snippets. The repo's own
snippets (KISS, meaningful-tests, scope-creep, research-escape-hatch) were
committed, deployed and byte-identical to source, yet missing from the picker.

**Cause.** Setup deployed `extensions/prompt-snippets/index.ts` as a symlink into
`pi/upstream/pi-config-<ref>/`. Pi's extension loader calls `realpathSync` on the
extension path before importing it (`canonicalizePath` in
`dist/core/extensions/loader.js`, seen in Pi 1.5.2). The extension finds its
snippets with `dirname(import.meta.url)`, so it read the upstream package's
`snippets/` directory, not the deployed one.

**Why tests passed.** `pi/tests/lifecycle-deployment/snippets.mjs` and
`pi/tests/snippets-fixture.mjs` imported the symlink with plain Jiti, which does
not resolve symlinks. They exercised a path Pi never takes.

**Correction.** `pi/setup.sh` copies `index.ts` for prompt-snippets instead of
linking it; the other pi-config extensions keep their symlinks because they read
no sibling data. The lifecycle snippet test now imports the real path, as Pi does.

**Next time.**
- When an extension reads files beside itself, deploy it as a real file.
- A test that loads an extension must resolve the path the way Pi's loader does.
  A passing picker test with plain Jiti is not proof of what Pi shows.
- "Missing" deployed content can be a lookup-path problem. Check where the
  running code reads from before looking for deleted files.

**Verify.** `./init.sh --pi`, then
`CONFIG_PI_HOME="$HOME/.pi" node pi/tests/lifecycle-deployment/snippets.mjs`.

**Not proven.** The fix was verified by loading the deployed extension through its
real path, not by driving Ctrl+R in a live Pi terminal. `pi/test-vimmode.sh` and
`pi/tests/review-comments-tui.sh` still build their fixture agents with a symlink;
they only check that the picker opens.

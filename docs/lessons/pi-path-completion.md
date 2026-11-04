# Pi path completion

## Version upgrades can remove the fix

The active global Pi upgraded to 1.0.4 while `pi/path-completion.sh` supported
only 0.85.1 and 0.87.0. Setup warned and left the unfamiliar assets untouched.
Enter on a stale menu then applied an old prefix length to newer input,
duplicating part of the typed path. The offline terminal test reproduced this
on the actual global CLI before adding 1.0.4 support.

- Keep exact version and SHA checks. Unknown code must remain untouched.
- Test the executable resolved by `pi/command-path.sh`, not just the repository's
  pinned CLI. The bundled editor and extension-resolved native editor are separate
  assets; both need patch support.
- The 1.0.4 bundle renamed a local parameter from `state2` to `state`. Match the
  unique assignment sequence instead of that parameter. Existing older output
  hashes must still match.
- Apply changes through `./init.sh --pi`, then restart Pi. `/reload` cannot replace
  loaded native editor classes.

## Verification

`pi/test-path-completion.sh` drives the actual CLI in isolated tmux with an offline
provider. It checks Enter/Tab, Vim on/off, stale file and directory prefixes,
quoted paths, cursor suffixes, cancellation, and submitted messages. Set
`PI_PATH_CLI` to the resolved active executable to test global upgrades.
`pi/tests/path-completion-deploy.sh` checks original and intermediate patch states,
hashes, permissions, idempotence, and refusal to overwrite unknown edits.

Coverage is keyboard acceptance. Source review found that mouse selection bypasses
the stale-snapshot keyboard guard in both pinned and 1.0.4 editors; mouse acceptance
was not fixed or runtime-tested here. Unsupported future versions still require
review and explicit hash support. The separate render-width patch does not support
1.0.4 and is outside this fix.

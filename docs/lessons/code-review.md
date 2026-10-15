# Code-review instruction compliance

The CLAUDE.md compliance finder owns architecture and organization at medium and
above. It rereads governing repository instructions from the reviewed revision,
checks ownership, boundaries and placement, and cites the exact applicable rule.
Generic altitude analysis and non-architectural conventions remain separate angles;
merge duplicate mechanisms without losing rule evidence. Low stays diff-only.

Do not apply one project's architecture to another. Scoped instructions and
explicit exceptions matter. Missing CLAUDE.md is a coverage limit, not permission
to invent an architecture. A proposed destination needs source inspection, and a
confirmed violation does not authorize an architectural refactor.

`claude/tests/code-review-compliance-cases.sh` generates synthetic snapshots for
misplaced business logic/methods, a scoped serialization exception, and absent repo
instructions. Compare the dedicated finder with the prior conventions finder;
these are angle evaluations, not full-workflow verification. The existing angle
can already find explicit violations, so passing examples alone is not evidence
of improved accuracy. The dedicated angle makes coverage explicit.

`claude/test-code-review-setup.sh` checks installed resources, level coverage, and
safe migrations. Installed skill versions need whole-bundle fingerprints before
migration; recognizing only an older entrypoint hash leaves newer shipped bundles
unchanged. Preserve modified references, added content, symlinks and existing
backups. Deploy through `init.sh`, not by editing the installed skill directory.
`claude/test-code-review-live.sh --run medium` is the quota-using full-workflow check;
its minimum includes nine finders, a candidate verifier and the final verifier.

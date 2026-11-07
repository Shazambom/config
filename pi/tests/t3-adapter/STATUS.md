# Adapter implementation checkpoints

## Current source after live-profile fixes

The routing guidance, same-canonical-directory handling, and shipped
`lineage-only` profile compatibility fixes were reviewed and deployed through
checked `init.sh`. Current adapter patch SHA256:
`4b6db33ea2198473cec058ebf83841e224c945bfe803368a3287125a191bde01`.

Parent-focused proofs: `$TMPDIR/t3-cwd-final-parent.nu5uV1/` and
`$TMPDIR/t3-lineage-parent.WTGyCk/`. Live T3 proof with the unchanged shipped
reviewer and explicit shared cwd: `$TMPDIR/t3-live-fresh.nHpFWy/`, including
actual launch and terminal-result metadata. Deployment receipt:
`$TMPDIR/t3-lineage-deploy.1Nonve/receipt.json`.
The original retained application session was not restarted. No T3 app files or
settings were changed. This finite live test is not universal profile/UI proof.

## Prior high-review checkpoint

The parent completed high review and deployed through `init.sh --pi-no-terminal`.
Installed readiness and reviewed adapter byte identity passed. Deployment evidence:
`$TMPDIR/t3-deploy-fixed.M48qbk/`.

## Prior published source

Before the live-profile fixes above, `pi/patches/interactive-subagents.patch`
matched this frozen review-fix candidate:

`$TMPDIR/t3-review-fixes.0DcYRe/interactive-subagents.patch`

Verified SHA256:
`42cd1412ab14535b317c34bd3eb36e69a654cb5cc53badee3249c7f5ad47a6d0`

The frozen hash was checked before copying. Byte comparison, the published hash,
and `git diff --check` passed afterward. Only this patch and this status file
were changed during final publication. Inherited patch content was preserved.

## Frozen artifacts and worker checks

`$TMPDIR/t3-review-fixes.0DcYRe/` contains the matching package, settings,
lifecycle sources, hashes, `fixes-vs-K2jWtB.diff`, and `CHECKPOINT.md`.

That checkpoint records actual RED/GREEN evidence for:

- Failed local registration after native creation: preserved receipt, native
  cancellation and exact terminal cleanup without an endless obligation.
- Aborted initialization/discovery followed by a fresh successful request.
- Refusal to blindly replay partially claimed admission.
- Settlement state-read reduction while missing/mismatched/running rows still
  refresh and failed-launch cleanup still finalizes.
- Removal of write-only state.
- Started/pre-start cancellation and cancellation during pending registration.

Focused progression, abort, retained-resume and syntax checks also passed.
These worker tests use real Pi with controlled T3 fixtures; they are not
represented as actual-host proof.

## Parent verification report

The parent reports six focused cases plus actual-host resume and arena GREEN on
this final candidate. The independent final verifier reported no findings; the
parent published the high-review result with no remaining findings. Those checks were
not rerun by this worker and are not claimed as worker-executed tests.

No native-core files, T3 application files, or deployed Pi state were changed by
this worker. Prior frozen candidates and private diagnostics remain preserved.

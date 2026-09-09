---
name: comment
description: Instructions of how to handle comments
---

Look at the comments in this branch with the rules around comments in mind. You have violated them in one way or another. Make sure to remove as much of the comments you've produced on this current branch as possible. The user is disatisfied with the comments you've produced and they actively are getting in the way of comprehending the code.

GOLDEN COMMENT RULES: 
  1. Zero comments by default on any change.
  2. If a comment isn't needed to understand the code, remove it.
  3. If you find a violating comment, fix it to comply. 
  4. A comment must describe what the code does, nothing more.
  5. A comment only earns its place when the code cannot say it: opaque algorithm, non-obvious invariant, deliberate deviation.
  6. Never write tangential rationale for why a value or piece of code exists.
  7. Never write what changed or why it changed.
  8. No comments inside structs, ever.
  9. Comments are a product of the codebase as a whole over time not your limited current context.


The default number of comments on any change is zero. A comment earns its place only when it explains something the code cannot say itself, for example an opaque algorithm, a non-obvious invariant, or a deliberate deviation.
A comment should describe what the code does and nothing more.
Comments shouldn't contain information about what changed and why, they should simply describe what a piece of code does if it's confusing; if a comment isn't needed to understand a piece of code it should be removed. If you find a comment violating this rule change it to comply with the rule. Comments don't belong inside of structs, they should never be placed there and should be avoided at all cost.

Bad — describes a tangential reason the value exists instead of what the code does:
// The floor is the providers sync's assignment sweep: one therapists call
// per service against Zenoti's 60/min ceiling, so a ~175-service center
// needs about three minutes before the rest of the chunk even starts.
messageTimeout := envDuration("SCHEDULER_WORKER_MESSAGE_TIMEOUT", 6*time.Minute)

Good — says what the setting does:
// SCHEDULER_WORKER_MESSAGE_TIMEOUT controls how long a sync job worker will
// process before hitting a context deadline timeout.
messageTimeout := envDuration("SCHEDULER_WORKER_MESSAGE_TIMEOUT", 6*time.Minute)


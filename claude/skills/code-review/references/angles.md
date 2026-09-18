# Finder angles

Each finder works only its assigned angle. Read source before extra context. Return up to the level's candidate ceiling using the candidate contract. Correctness outranks cleanup in the final report, but all assigned angles must run.

## A: Line-by-line correctness

Read every hunk line by line, then the enclosing functions. Ask what input, state, timing, or platform makes each change wrong. Check inverted conditions, off-by-one boundaries, null dereferences, missing awaits, falsy-zero checks, wrong-variable copies, swallowed errors, and unescaped regex metacharacters. Unchanged function lines qualify only through a concrete connection to the touched path.

## B: Removed behavior

For every deletion or replacement, name the behavior or invariant it enforced. Find where the new code re-establishes it. Missing guards, error paths, validation, and deleted tests covering real behavior are candidates when the missing behavior is still required. Intentional removal alone is not a bug; name the broken contract or reachable consequence.

## C: Caller and callee tracing

Find callers of changed functions and check new preconditions, return shapes, exceptions, timing, and ordering. Inspect relevant callees, including other changes in the same diff that make a formerly safe call unsafe. Show the affected call path rather than guessing from a function name.

## Reuse

Search adjacent code and relevant shared utility modules for an existing implementation of new logic. Name the helper and show that its contract fits. Explain the duplicated behavior or maintenance cost. Similar-looking code with different semantics is not enough.

## Simplification

Look for redundant or derivable state, near-copy duplication, unnecessary nesting, and dead code introduced or left behind by the diff. Name a simpler equivalent form and the concrete maintenance cost it removes. Do not propose broad refactors based on taste.

## Efficiency

Find repeated computation or I/O, independent work unnecessarily serialized, and blocking startup or hot-path work. State the triggering workload, wasted work, and cheaper equivalent. Check semantic ordering before suggesting concurrency.

For retention claims, identify the actual captured value, reference chain, reachability, and lifetime. Closures do not inherently retain an entire enclosing scope, and a closure is not inherently a leak. Require evidence of unintended retention or cost before recommending a class, struct, or different capture strategy.

## Altitude

Check whether the change belongs at its current layer. A special case may hide a shared invariant, but generalization is not automatically better. Name the actual duplicated policy, bypassed invariant, fragility, or maintenance cost and the smallest appropriate correction. Apply KISS: keep a local fix when it solves the requirement cleanly. Do not recommend a generic abstraction or architecture expansion without evidence of cost.

## Conventions

Read only the applicable instruction files described in the scope reference. Quote the exact rule, its path, and the exact changed code violating it. No inferred house style or vague appeals to the document's spirit. Rules apply only within their scope; resolve conflicting instructions by precedence. If no applicable rule is violated, return no candidates.

## D: Language and framework pitfalls

Xhigh/max only. Check actual language/runtime versions before assuming pitfalls: JavaScript coercion and captured loop variables, Python mutable defaults and late binding, Go nil-map writes and version-dependent range semantics, unsafe SQL construction, timezone/DST behavior, and float equality. Connect each candidate to the changed path and concrete input.

## E: Wrapper delegation

Xhigh/max only. For caches, proxies, decorators, and adapters, trace methods to the wrapped instance. Watch for re-entry through a registry, session, or global instead of the delegate, causing recursion or bypassed behavior. Check forwarding of methods callers actually use. A deliberate registry lookup is not wrong without a demonstrated broken delegation contract.

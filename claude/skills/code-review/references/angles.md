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

## CLAUDE.md compliance

At medium and above, assign a dedicated independent finder to this angle. Freshly reread the repository's `CLAUDE.md` and any scoped `CLAUDE.md` files governing the changed paths. Do not rely on remembered instructions or another reviewer's summary. Use the instruction scope and revision rules in the scope reference, including higher-priority instructions, local overrides, and relevant linked architecture guidance.

Extract the applicable architectural and organizational rules, then compare the changed code with them. Focus on layer and package ownership, inward/outward dependency rules, type and representation boundaries, file placement and co-location, ownership of lifecycle operations, and the prescribed homes for configuration and shared utilities. Use the repository's stated philosophy, not a preferred architecture imported from another project. No applicable `CLAUDE.md` means no CLAUDE-specific findings; record that coverage limit rather than inventing rules.

For each candidate, quote the exact applicable rule with its file and line, identify the changed code that violates it, and explain the mismatch. For a placement issue, inspect the proposed destination or owning package before recommending the smallest justified relocation. Distinguish an explicit ownership rule from a general principle that needs concrete supporting evidence. Respect documented exceptions and any requirement to ask before creating packages or changing architecture.

Stay within the reviewed change; read surrounding organization as context, not permission for a repository-wide cleanup. Recommend architectural moves, do not perform them. Return category `claude-compliance`. A compliant change may produce no findings. During aggregation, deduplicate overlapping altitude or conventions candidates by mechanism while preserving the governing rule and destination evidence.

## Conventions

Read only the applicable instruction files described in the scope reference. Focus on concrete non-architectural conventions such as naming, logging, comments, and generated-file rules; the dedicated CLAUDE.md compliance finder owns architecture and organization. Quote the exact rule, its path, and the exact changed code violating it. No inferred house style or vague appeals to the document's spirit. Rules apply only within their scope; resolve conflicting instructions by precedence. If no applicable rule is violated, return no candidates.

## D: Language and framework pitfalls

Xhigh/max only. Check actual language/runtime versions before assuming pitfalls: JavaScript coercion and captured loop variables, Python mutable defaults and late binding, Go nil-map writes and version-dependent range semantics, unsafe SQL construction, timezone/DST behavior, and float equality. Connect each candidate to the changed path and concrete input.

## E: Wrapper delegation

Xhigh/max only. For caches, proxies, decorators, and adapters, trace methods to the wrapped instance. Watch for re-entry through a registry, session, or global instead of the delegate, causing recursion or bypassed behavior. Check forwarding of methods callers actually use. A deliberate registry lookup is not wrong without a demonstrated broken delegation contract.

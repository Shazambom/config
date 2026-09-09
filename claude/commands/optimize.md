---
description: Analyze code for performance issues and optimizations
---

Analyze the following for performance issues: $ARGUMENTS

## Step 1: Profile the Code
- Identify the hot paths (most frequently executed code)
- Look for O(n²) or worse algorithms
- Check for unnecessary allocations

## Step 2: Common Go Performance Issues

### Database
- N+1 query problems
- Missing indexes for query patterns
- Unbounded result sets
- Connection pool exhaustion

### Memory
- Unnecessary allocations in loops
- Large structs passed by value instead of pointer
- Slice capacity not pre-allocated
- String concatenation in loops (use strings.Builder)

### Concurrency
- Lock contention
- Goroutine leaks
- Channel buffer sizing
- Unnecessary synchronization

### I/O
- Unbuffered readers/writers
- Missing connection timeouts
- Excessive logging in hot paths

## Step 3: Measure Before Optimizing
- What is the current performance baseline?
- Where is time actually being spent?
- Is this optimization necessary?

## Step 4: Recommendations
For each issue found:
1. What is the problem?
2. What is the impact?
3. What is the fix?
4. What is the expected improvement?

Remember: Correctness first, then optimize only what matters.

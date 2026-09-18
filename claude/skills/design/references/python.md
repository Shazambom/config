# Python documents

Read [design.py.txt](design.py.txt) and [support.py.txt](support.py.txt) in full. They show the same order-placement scope as Go: input provenance, store error handling, receipt derivation, and an unresolved duplicate-key policy.

Use `design.py` and optional `support.py` in a fresh isolated directory. Start with a triple-quoted module docstring containing spacious Python pseudocode. Keep proposed contracts below it and unchanged inspected types in support. Import support explicitly. Target Python 3.9 or later; the examples avoid 3.10-only unions and `TypeAlias` imports. Use only the standard library, with `NamedTuple`, `TypedDict`, `NewType`, `Callable`, and aliases when they honestly express the contract. Use a `Protocol` only for a real existing or proposed structural interface, never merely to make diagnostics disappear.

Prefer `Callable` for signatures that need no named parameters. Where parameter names or method ownership matter, a `def` signature may have exactly `...` as its suite. An otherwise empty type declaration may likewise use only `...`. These are the minimum grammar needed for declarations in `.py`, not implementations. No `pass`, return values, raises, decorators generating behavior, or concrete function bodies. `NewType` declarations are permitted solely as nominal type declarations, not computed application values. Do not run/import the proposal as an application.

The examples model the Go contracts, not a proposed Python rewrite. Their source labels identify that provenance. `Optional[list[T]]` retains absent-versus-empty slices, and explicit result/error tuples retain the source error channel. Nominal string identifiers do not establish validation rules. Python annotations do not enforce runtime immutability, validation, or ownership. If these distinctions matter beyond what annotations show, keep a short invariant or mark the gap `UNRESOLVED`. Native Python project proposals should use that project's actual signatures and error conventions instead.

Validate syntax with `python3 -m ast design.py` and the same command for support, or use `ast.parse` without executing the files. Type-check with `pyright --project .` when available. If isolation needs configuration, keep a `pyrightconfig.json` here with only local includes, snapshot/cache exclusions, `pythonVersion` matching the installed supported interpreter, and strict checking. For example:

```json
{
  "include": ["design.py", "support.py"],
  "exclude": ["snapshots", "__pycache__"],
  "pythonVersion": "3.9",
  "typeCheckingMode": "strict"
}
```

Do not suppress missing types or return diagnostics to accommodate implementation placeholders. Do not install libraries, create a virtual environment, or alter project/editor configuration. Keep lines near 100 columns and blank lines between flow steps. Report missing Python or pyright separately; an AST parse is not a type check. Snapshot both source files and any local checker configuration with `.txt` suffixes.

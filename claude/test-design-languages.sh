#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
refs="$repo/claude/skills/design/references"
if [[ -d "$HOME/.cargo/bin" ]]; then
  export PATH="$PATH:$HOME/.cargo/bin"
fi
command -v jq >/dev/null 2>&1 || { echo 'jq is required.' >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo 'Python is required for AST checks.' >&2; exit 1; }
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/design-languages-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
missing=0
unverified() {
  printf 'UNVERIFIED: %s\n' "$*" >&2
  missing=1
}
for language in python rust; do
  mkdir -p "$test_dir/$language/snapshots/revision-001"
done
for file in design.py support.py; do
  cp "$refs/$file.txt" "$test_dir/python/$file"
done
jq -n '{include:["design.py","support.py"],exclude:["snapshots","__pycache__"],pythonVersion:"3.9",typeCheckingMode:"strict"}' > "$test_dir/python/pyrightconfig.json"
jq -e '.include == ["design.py","support.py"] and .exclude == ["snapshots","__pycache__"] and .typeCheckingMode == "strict"' "$test_dir/python/pyrightconfig.json" >/dev/null
for file in design.rs support.rs; do
  cp "$refs/$file.txt" "$test_dir/rust/$file"
done
printf '[package]\nname = "design-session"\nversion = "0.0.0"\nedition = "2021"\n\n[lib]\npath = "design.rs"\n\n[workspace]\n' > "$test_dir/rust/Cargo.toml"
python3 - "$test_dir/python" <<'PY'
import ast
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
for name in ('design.py', 'support.py'):
    tree = ast.parse((root / name).read_text())
    if name == 'design.py':
        flow = ast.get_docstring(tree)
        assert flow and flow.startswith('FLOW: place an order')
        for marker in ('INPUTS:', 'DERIVATION: receipt', 'if error is not None:', 'return receipt, None'):
            assert marker in flow, marker
        assert not any(isinstance(node, ast.ClassDef) and node.name in
                       ('Context', 'OrderStore', 'OrderItem') for node in tree.body)
    for node in ast.walk(tree):
        assert not isinstance(node, (ast.For, ast.While, ast.Return, ast.Raise, ast.Lambda, ast.If, ast.Try))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            assert not node.decorator_list
            assert len(node.body) == 1 and isinstance(node.body[0], ast.Expr)
            assert isinstance(node.body[0].value, ast.Constant) and node.body[0].value.value is Ellipsis
        if isinstance(node, ast.Call):
            assert isinstance(node.func, ast.Name) and node.func.id == 'NewType'
            assert all(isinstance(arg, (ast.Constant, ast.Name)) for arg in node.args)
print('PASS: Python AST contains declarations and ellipsis-only signatures, with flow first.')
PY
for spec in 'python py' 'rust rs'; do
  read -r language extension <<< "$spec"
  for section in 'ADDED CONTRACTS' 'CHANGED CONTRACTS' 'REMOVED CONTRACTS' 'Source:' 'UNRESOLVED:'; do
    grep -Fq "$section" "$test_dir/$language/design.$extension"
  done
  grep -Fq 'TOOLING SUPPORT ONLY - NOT PROPOSED CHANGES' "$test_dir/$language/support.$extension"
done
awk 'NR == 1 && $0 != "/*" { exit 1 } NR == 2 && $0 != "FLOW: place an order" { exit 1 } $0 == "*/" { closed = 1; next } closed { print } END { if (!closed) exit 1 }' "$test_dir/rust/design.rs" > "$test_dir/rust-contracts.txt"
if grep -Eq '(^| )(fn [A-Za-z_].*\{|impl |todo!|unimplemented!|panic!)' "$test_dir/rust-contracts.txt" "$test_dir/rust/support.rs"; then
  echo 'Rust contracts must not contain implementation bodies.' >&2
  exit 1
fi
if command -v pyright >/dev/null 2>&1; then
  (cd "$test_dir/python" && pyright --project .)
else
  unverified 'pyright type checking; tool not installed'
fi
if command -v cargo >/dev/null 2>&1; then
  (cd "$test_dir/rust" && RUSTUP_AUTO_INSTALL=0 CARGO_NET_OFFLINE=true cargo check --offline --lib --target-dir "$PWD/target")
else
  unverified 'Rust type checking; cargo not installed'
fi
if command -v rustfmt >/dev/null 2>&1; then
  (cd "$test_dir/rust" && RUSTUP_AUTO_INSTALL=0 rustfmt --check --edition 2021 design.rs support.rs)
else
  unverified 'Rust formatting; rustfmt not installed'
fi
if command -v go >/dev/null 2>&1 && command -v gopls >/dev/null 2>&1; then
  bash "$repo/claude/test-design-go.sh"
else
  unverified 'Go compiler/gopls checks; tools not installed'
fi
for language in python rust; do
  for file in "$test_dir/$language"/*; do
    [[ -f "$file" ]] || continue
    destination="$test_dir/$language/snapshots/revision-001/$(basename "$file").txt"
    cp "$file" "$destination"
    cmp "$file" "$destination"
  done
  [[ -z "$(find "$test_dir/$language/snapshots" -type f ! -name '*.txt' -print)" ]]
done
printf '%s\n' 'PASS: contract layout and text-only complete package snapshots.'
if [[ "$missing" == 1 ]]; then
  printf '%s\n' 'Some tool checks remain UNVERIFIED; set DESIGN_REQUIRE_TOOLS=1 to require all tools.' >&2
  [[ "${DESIGN_REQUIRE_TOOLS:-0}" != 1 ]] || exit 1
fi

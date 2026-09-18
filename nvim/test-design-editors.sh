#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v nvim >/dev/null
command -v jq >/dev/null
umask 077
proof="$(mktemp -d "${TMPDIR:-/tmp}/design-editors-proof.XXXXXX")"
printf 'Proof directory: %s\n' "$proof"
refs="$repo/claude/skills/design/references"
for spec in 'go go go' 'python py pyright' 'rust rs rust-analyzer'; do
  read -r language extension service <<< "$spec"
  dir="$proof/$language"
  mkdir "$dir"
  cp "$refs/design.$extension.txt" "$dir/design.$extension"
  cp "$refs/support.$extension.txt" "$dir/support.$extension"
  case "$language" in
    go) printf 'module design.local/session\n\ngo 1.20\n' > "$dir/go.mod" ;;
    python) jq -n '{include:["design.py","support.py"],pythonVersion:"3.9",typeCheckingMode:"strict"}' > "$dir/pyrightconfig.json" ;;
    rust) printf '[package]\nname = "design-session"\nversion = "0.0.0"\nedition = "2021"\n\n[lib]\npath = "design.rs"\n\n[workspace]\n' > "$dir/Cargo.toml" ;;
  esac
  (
    cd "$dir"
    export DESIGN_EDITOR_FILE="$dir/design.$extension" DESIGN_EDITOR_REPORT="$dir/editor.json" DESIGN_EXPECT_FILETYPE="$language" DESIGN_EXPECT_SERVICE="$service"
    export GOWORK=off GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off CARGO_NET_OFFLINE=true
    nvim --headless -n -i NONE --cmd 'set nobackup nowritebackup noundofile' "design.$extension" "+lua vim.defer_fn(function() dofile('$repo/nvim/tests/design-check.lua') end, 100)" > "$dir/nvim.log" 2>&1
  ) || { printf 'FAIL: %s; inspect %s\n' "$language" "$dir" >&2; exit 1; }
  jq -e '.passed == true and (.captures | length > 0) and (.negative_diagnostics | length > 0) and ([.restored_diagnostics[] | select(.level <= 2 or (.message | contains("MissingDesignType")))] | length == 0)' "$dir/editor.json" >/dev/null
  cmp "$refs/design.$extension.txt" "$dir/design.$extension"
  printf 'PASS: %s deployed Neovim filetype, Tree-sitter colors, Coc symbols and semantic diagnostic round trip\n' "$language"
done
node "$repo/pi/tests/design-view-fixture.mjs" "$proof"
printf 'Proof directory: %s\n' "$proof"

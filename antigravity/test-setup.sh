#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/antigravity-setup-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT

assert_skills_match() {
  local src_root="$1" dst_root="$2"
  local src name dst
  [[ -d "$dst_root" && ! -L "$dst_root" ]]
  for src in "$src_root"/*; do
    [[ -d "$src" && -f "$src/SKILL.md" ]] || continue
    name="${src##*/}"
    dst="$dst_root/$name"
    [[ -d "$dst" && ! -L "$dst" ]]
    diff -qr "$src" "$dst" >/dev/null
    [[ -z "$(find "$dst" -type l -print -quit)" ]]
  done
  [[ -z "$(find "$(dirname -- "$dst_root")" -maxdepth 1 -name '.skills-deploy.*' -print -quit)" ]]
}

# 1. Fresh end-to-end deploy through init.sh --antigravity across ~/.gemini and T3 provider homes.
home1="$test_dir/home1"
decoy_gemini="$test_dir/decoy-gemini"
link_outside="$test_dir/link-outside"
mkdir -p \
  "$home1/.t3/userdata/providers/antigravity/inst-a/antigravity-acp" \
  "$home1/.t3/userdata/providers/antigravity/inst-b" \
  "$link_outside"
printf '{"auth":{"type":"oauth-personal"}}\n' > "$home1/.t3/userdata/providers/antigravity/inst-a/antigravity-acp/settings.json"
printf 'keep\n' > "$home1/.t3/userdata/providers/antigravity/metadata.txt"
ln -s "$link_outside" "$home1/.t3/userdata/providers/antigravity/linked-inst"

HOME="$home1" GEMINI_HOME="$decoy_gemini" bash "$repo/init.sh" --antigravity

assert_skills_match "$repo/claude/skills" "$home1/.gemini/config/skills"
assert_skills_match "$repo/claude/skills" "$home1/.t3/userdata/providers/antigravity/inst-a/config/skills"
assert_skills_match "$repo/claude/skills" "$home1/.t3/userdata/providers/antigravity/inst-b/config/skills"
[[ -x "$home1/.gemini/config/skills/complaint/scripts/complaints.sh" ]]
[[ -x "$home1/.t3/userdata/providers/antigravity/inst-a/config/skills/complaint/scripts/complaints.sh" ]]
[[ ! -e "$decoy_gemini" ]]
[[ ! -e "$link_outside/config" ]]
[[ "$(< "$home1/.t3/userdata/providers/antigravity/metadata.txt")" == keep ]]
[[ ! -e "$home1/.pi" && ! -e "$home1/.claude" && ! -e "$home1/.config/nvim" ]]

# 2. Idempotence and preservation of custom skills and unrelated config/state.
mkdir -p "$home1/.gemini/config/skills/custom-local"
printf -- '---\nname: custom-local\ndescription: local\n---\n' > "$home1/.gemini/config/skills/custom-local/SKILL.md"
printf '{"mcpServers":{}}\n' > "$home1/.gemini/config/mcp_config.json"

HOME="$home1" GEMINI_HOME="$decoy_gemini" bash "$repo/init.sh" --antigravity

assert_skills_match "$repo/claude/skills" "$home1/.gemini/config/skills"
assert_skills_match "$repo/claude/skills" "$home1/.t3/userdata/providers/antigravity/inst-a/config/skills"
[[ -f "$home1/.gemini/config/skills/custom-local/SKILL.md" ]]
[[ "$(< "$home1/.gemini/config/mcp_config.json")" == '{"mcpServers":{}}' ]]
[[ "$(< "$home1/.t3/userdata/providers/antigravity/inst-a/antigravity-acp/settings.json")" == '{"auth":{"type":"oauth-personal"}}' ]]

# 3. Updating a bundled skill replaces stale files while keeping custom skills intact.
fixture="$test_dir/fixture-repo"
mkdir -p "$fixture/claude/skills/sample/references" "$fixture/antigravity"
cp "$repo/init.sh" "$fixture/init.sh"
cp "$repo/antigravity/setup.sh" "$fixture/antigravity/setup.sh"
printf -- '---\nname: sample\ndescription: v1\n---\nbody v1\n' > "$fixture/claude/skills/sample/SKILL.md"
printf 'old ref\n' > "$fixture/claude/skills/sample/references/old.md"

home2="$test_dir/home2"
mkdir -p "$home2/.gemini/config/skills/keep-me"
printf 'keep\n' > "$home2/.gemini/config/skills/keep-me/SKILL.md"

HOME="$home2" bash "$fixture/init.sh" --antigravity
[[ -f "$home2/.gemini/config/skills/sample/references/old.md" ]]
[[ ! -e "$home2/.t3" ]]

# Empty T3 providers directory succeeds cleanly without creating stray entries.
mkdir -p "$home2/.t3/userdata/providers/antigravity"
printf -- '---\nname: sample\ndescription: v2\n---\nbody v2\n' > "$fixture/claude/skills/sample/SKILL.md"
rm "$fixture/claude/skills/sample/references/old.md"
printf 'new ref\n' > "$fixture/claude/skills/sample/references/new.md"

HOME="$home2" bash "$fixture/init.sh" --antigravity
diff -qr "$fixture/claude/skills/sample" "$home2/.gemini/config/skills/sample" >/dev/null
[[ ! -e "$home2/.gemini/config/skills/sample/references/old.md" ]]
[[ -f "$home2/.gemini/config/skills/sample/references/new.md" ]]
[[ "$(< "$home2/.gemini/config/skills/keep-me/SKILL.md")" == keep ]]
[[ -z "$(ls -A "$home2/.t3/userdata/providers/antigravity")" ]]

# 4. Refusal paths: symlinks and non-directory collisions must fail without touching targets.
outside="$test_dir/outside-sentinel"
mkdir -p "$outside"
printf 'untouched\n' > "$outside/marker"

for case_name in root-link config-link skills-link skill-link skill-file t3-provider-collision; do
  bad_home="$test_dir/bad-$case_name"
  mkdir -p "$bad_home"
  case "$case_name" in
    root-link)
      ln -s "$outside" "$bad_home/.gemini"
      ;;
    config-link)
      mkdir -p "$bad_home/.gemini"
      ln -s "$outside" "$bad_home/.gemini/config"
      ;;
    skills-link)
      mkdir -p "$bad_home/.gemini/config"
      ln -s "$outside" "$bad_home/.gemini/config/skills"
      ;;
    skill-link)
      mkdir -p "$bad_home/.gemini/config/skills"
      ln -s "$outside" "$bad_home/.gemini/config/skills/sample"
      ;;
    skill-file)
      mkdir -p "$bad_home/.gemini/config/skills"
      printf 'do-not-clobber\n' > "$bad_home/.gemini/config/skills/sample"
      ;;
    t3-provider-collision)
      mkdir -p "$bad_home/.t3/userdata/providers/antigravity/inst-bad/config/skills"
      ln -s "$outside" "$bad_home/.t3/userdata/providers/antigravity/inst-bad/config/skills/sample"
      ;;
  esac
  if HOME="$bad_home" bash "$fixture/init.sh" --antigravity >/dev/null 2>&1; then
    printf 'FAIL: expected refusal for %s\n' "$case_name" >&2
    exit 1
  fi
  [[ "$(< "$outside/marker")" == untouched ]]
  [[ ! -e "$outside/sample" && ! -e "$outside/skills" && ! -e "$outside/config" ]]
  if [[ "$case_name" == skill-file ]]; then
    [[ "$(< "$bad_home/.gemini/config/skills/sample")" == do-not-clobber ]]
  fi
  if [[ "$case_name" == t3-provider-collision ]]; then
    [[ ! -e "$bad_home/.gemini" ]]
  fi
done

# 5. init.sh dispatch: --antigravity runs only Antigravity; --pi skips it; default runs Pi then Antigravity.
dispatch="$test_dir/dispatch"
mkdir -p "$dispatch/repo/pi" "$dispatch/repo/tmux" "$dispatch/repo/iterm2" "$dispatch/repo/antigravity" "$dispatch/repo/nvim" "$dispatch/home"
cp "$repo/init.sh" "$dispatch/repo/init.sh"
printf 'ensure_pi_runtime() { :; }\n' > "$dispatch/repo/pi/runtime.sh"
printf 'ensure_pi_jq() { :; }\n' > "$dispatch/repo/pi/jq.sh"
for pair in \
  pi/setup.sh:pi \
  tmux/setup.sh:tmux \
  iterm2/setup.sh:iterm2 \
  iterm2/runtime.sh:iterm-runtime \
  antigravity/setup.sh:antigravity; do
  printf 'printf "%%s\\n" %q >> %q\n' "${pair#*:}" "$dispatch/calls" > "$dispatch/repo/${pair%:*}"
done
# Stop default init.sh right as Neovim starts so we verify ordering without touching Neovim.
printf 'printf "nvim-start\\n" >> %q; exit 42\n' "$dispatch/calls" > "$dispatch/repo/nvim/setup-language-tools.sh"
: > "$dispatch/repo/init.vim"
: > "$dispatch/repo/coc-settings.json"

HOME="$dispatch/home" bash "$dispatch/repo/init.sh" --antigravity
printf 'antigravity\n' > "$dispatch/expected"
cmp "$dispatch/calls" "$dispatch/expected"

: > "$dispatch/calls"
HOME="$dispatch/home" CONFIG_PI_HOME="$dispatch/managed" bash "$dispatch/repo/init.sh" --pi
printf 'pi\ntmux\niterm2\niterm-runtime\n' > "$dispatch/expected"
cmp "$dispatch/calls" "$dispatch/expected"

: > "$dispatch/calls"
set +e
HOME="$dispatch/home" CONFIG_PI_HOME="$dispatch/managed" bash "$dispatch/repo/init.sh"
rc=$?
set -e
[[ "$rc" == 42 ]]
printf 'pi\ntmux\niterm2\niterm-runtime\nantigravity\nnvim-start\n' > "$dispatch/expected"
cmp "$dispatch/calls" "$dispatch/expected"

printf '%s\n' 'PASS: Antigravity init deploys skills to ~/.gemini and T3 provider homes, updates cleanly, preserves custom state, refuses unsafe targets, and dispatches properly.'

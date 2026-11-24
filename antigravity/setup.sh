#!/usr/bin/env bash
# Invoked through init.sh --antigravity or default init.sh.
# Deploys bundled claude/skills/ as real directory copies (not symlinks, because
# antigravity-acp enforces realpath-based allowed_dirs containment for view_file)
# into ~/.gemini/config/skills and any T3 Code Antigravity provider homes under
# ~/.t3/userdata/providers/antigravity/*.
set -euo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
skills_source="$repo/claude/skills"

if [[ ! -d "$skills_source" ]]; then
  printf 'Bundled skills directory not found: %s\n' "$skills_source" >&2
  exit 1
fi

skill_sources=()
for source in "$skills_source"/*; do
  [[ -d "$source" && -f "$source/SKILL.md" ]] || continue
  skill_sources+=("$source")
done

if (( ${#skill_sources[@]} == 0 )); then
  printf 'No bundled skills found under %s\n' "$skills_source" >&2
  exit 1
fi

if [[ -n "$(find "$skills_source" -type l -print -quit)" ]]; then
  printf 'Refusing to deploy symlinks inside %s; Antigravity requires real files inside config/skills.\n' "$skills_source" >&2
  exit 1
fi

current_stage=''
cleanup() {
  if [[ -n "$current_stage" && -d "$current_stage" ]]; then
    rm -rf -- "$current_stage"
  fi
}
trap cleanup EXIT

assert_safe_dir() {
  local path="$1"
  if [[ -L "$path" || ( -e "$path" && ! -d "$path" ) ]]; then
    printf 'Refusing to deploy into symlink or non-directory: %s\n' "$path" >&2
    exit 1
  fi
}

validate_target() {
  local target="$1"
  local config_dir="$target/config"
  local skills_dir="$config_dir/skills"
  local source name

  assert_safe_dir "$target"
  assert_safe_dir "$config_dir"
  assert_safe_dir "$skills_dir"

  for source in "${skill_sources[@]}"; do
    name="${source##*/}"
    assert_safe_dir "$skills_dir/$name"
  done
}

deploy_target() {
  local target="$1"
  local config_dir="$target/config"
  local skills_dir="$config_dir/skills"
  local source name dest updated=0

  mkdir -p "$skills_dir"

  for source in "${skill_sources[@]}"; do
    name="${source##*/}"
    dest="$skills_dir/$name"
    if [[ -d "$dest" ]] && diff -qr "$source" "$dest" >/dev/null 2>&1; then
      continue
    fi
    if [[ -z "$current_stage" ]]; then
      current_stage="$(mktemp -d "$config_dir/.skills-deploy.XXXXXX")"
    fi
    mkdir -p "$current_stage/$name"
    cp -pR "$source/." "$current_stage/$name/"
    if [[ -d "$dest" ]]; then
      mv "$dest" "$current_stage/prev-$name"
      if ! mv "$current_stage/$name" "$dest"; then
        mv "$current_stage/prev-$name" "$dest" || true
        exit 1
      fi
    else
      mv "$current_stage/$name" "$dest"
    fi
    updated=$((updated + 1))
  done

  if [[ -n "$current_stage" ]]; then
    rm -rf -- "$current_stage"
    current_stage=''
  fi

  if (( updated == 0 )); then
    printf 'Antigravity skills up to date (%d) in %s\n' "${#skill_sources[@]}" "$skills_dir" >&2
  else
    printf 'Deployed %d/%d Antigravity skills to %s\n' "$updated" "${#skill_sources[@]}" "$skills_dir" >&2
  fi
}

targets=("$HOME/.gemini")
t3_providers="$HOME/.t3/userdata/providers/antigravity"
if [[ ! -L "$HOME/.t3" && ! -L "$HOME/.t3/userdata" && ! -L "$HOME/.t3/userdata/providers" && -d "$t3_providers" && ! -L "$t3_providers" ]]; then
  for entry in "$t3_providers"/*; do
    [[ -d "$entry" && ! -L "$entry" ]] || continue
    targets+=("$entry")
  done
fi

for target in "${targets[@]}"; do
  validate_target "$target"
done

for target in "${targets[@]}"; do
  deploy_target "$target"
done

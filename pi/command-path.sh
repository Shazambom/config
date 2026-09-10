#!/usr/bin/env bash
pi_is_launcher() {
  local first second
  [[ -f "$1" && ! -L "$1" ]] || return 1
  { IFS= read -r first; IFS= read -r second; } < "$1" || return 1
  [[ "$first" == '#!/usr/bin/env bash' && "$second" == '# portable-pi launcher' ]]
}

pi_real_command() {
  local target="$1" link count=0
  if pi_is_launcher "$target"; then
    target="$(dirname -- "$target")/.pi-portable-real"
  fi
  while [[ -L "$target" ]]; do
    (( count += 1 ))
    [[ "$count" -le 40 ]] || { echo 'Pi executable symlink loop.' >&2; return 1; }
    link="$(readlink "$target")" || return 1
    case "$link" in
      /*) target="$link" ;;
      *) target="$(dirname -- "$target")/$link" ;;
    esac
  done
  [[ -x "$target" ]] || { printf 'Pi CLI is missing or not executable: %s\n' "$target" >&2; return 1; }
  printf '%s/%s\n' "$(cd -- "$(dirname -- "$target")" && pwd -P)" "$(basename -- "$target")"
}

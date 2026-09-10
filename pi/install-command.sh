#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/command-path.sh"
[[ $# == 1 && "$1" == /* ]] || { echo 'Usage: install-command.sh /absolute/path/to/pi' >&2; exit 1; }
command_path="$1"
command_dir="$(dirname -- "$command_path")"
real_link="$command_dir/.pi-portable-real"
if ! pi_is_launcher "$command_path" && [[ ! -L "$command_path" ]]; then
  printf 'Cannot wrap unmanaged executable %s. Install the npm Pi CLI through init.sh first.\n' "$command_path" >&2
  exit 1
fi
real="$(pi_real_command "$command_path")"
if [[ -e "$real_link" && ! -L "$real_link" ]]; then
  printf 'Refusing to replace unmanaged file: %s\n' "$real_link" >&2
  exit 1
fi
stage="$(mktemp -d "$command_dir/.pi-launcher.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
ln -s "$real" "$stage/real"
{
  printf '%s\n' '#!/usr/bin/env bash' '# portable-pi launcher'
  printf 'command_path=%q\nrepo=%q\n' "$command_path" "$repo"
  printf '%s\n' \
    'bash "$repo/pi.sh" "$@"' \
    'status=$?' \
    'if [[ -z "${CONFIG_PI_HOME:-}" ]]; then' \
    '  bash "$repo/pi/install-command.sh" "$command_path" || echo "Pi launcher repair failed; rerun init.sh --pi." >&2' \
    'fi' \
    'exit "$status"'
} > "$stage/pi"
chmod 755 "$stage/pi"
mv -f "$stage/real" "$real_link"
mv -f "$stage/pi" "$command_path"

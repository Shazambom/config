#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/bootstrap.sh"
source "$repo/pi/command-path.sh"
cli="$(pi_real_command "$(command -v pi)")"
installed_cli="$cli"
artifacts="$(mktemp -d "${TMPDIR:-/tmp}/pi-t3-adapter.XXXXXX")"
chmod 700 "$artifacts"
printf 'Artifacts retained: %s\n' "$artifacts"
for name in $(compgen -e); do
  case "$name" in *API_KEY*|*TOKEN*|*SECRET*|PI_SUBAGENT*|PI_TEAM*|PI_LIFECYCLE_OWNER|PI_CODING_AGENT_DIR|T3_*|TMUX|TMUX_PANE) unset "$name" ;; esac
done
export HOME="$artifacts/home" PI_CODING_AGENT_DIR="$artifacts/agent" PI_OFFLINE=1
mkdir -p "$HOME" "$PI_CODING_AGENT_DIR"
if [ -n "${1:-}" ]; then
  source_dir="$(cd -- "$1" && pwd)"
else
  spec="$(jq -c '.[] | select(.name == "pi-interactive-subagents")' "$repo/pi/upstream.json")"
  ref="$(jq -r .ref <<< "$spec")"
  pi_download_verified "https://codeload.github.com/amosblomqvist/pi-interactive-subagents/tar.gz/$ref" "$artifacts/source.tgz" "$(jq -r .sha256 <<< "$spec")"
  tar -xzf "$artifacts/source.tgz" -C "$artifacts"
  source_dir="$artifacts/pi-interactive-subagents-$ref"
  (cd "$source_dir"; git apply --unidiff-zero "$repo/pi/patches/interactive-subagents.patch")
  ln -s "$repo/pi/node_modules" "$source_dir/node_modules"
fi
if [ -n "${2:-}" ]; then
  cli="$(pi_real_command "$2")"
fi
"$cli" --version > "$artifacts/version.txt"
case "${3:-leaf}" in
  settle-reads)
    node "$repo/pi/tests/t3-adapter/settle-reads.mjs" "$source_dir" "$artifacts"
    ;;
  admission-init|admission-discovery|admission-partial)
    node "$repo/pi/tests/t3-adapter/admission-retry.mjs" "$source_dir" "$cli" "$artifacts" "$3"
    ;;
  environment)
    node "$repo/pi/tests/t3-adapter/environment.mjs" "$source_dir" "$cli" "$artifacts" "$installed_cli"
    ;;
  resume-shipped|resume-retained|resume-replaced|resume-failure|resume-lost-response|resume-active-race|resume-cancel|resume-duplicate|resume-wrong-binding|resume-stale-completion)
    node "$repo/pi/tests/t3-adapter/resume.mjs" "$source_dir" "$cli" "$artifacts" "$3"
    ;;
  leaf)
    node "$repo/pi/tests/t3-adapter/runtime.mjs" "$source_dir" "$cli" "$artifacts"
    node "$repo/pi/tests/t3-adapter/leaf.mjs" "$source_dir" "$cli" "$artifacts"
    ;;
  arena|arena-off|arena-cancel|arena-cancel-prestart|arena-cancel-launch|arena-dropout|arena-delayed|arena-dropout-startup)
    node "$repo/pi/tests/t3-adapter/arena.mjs" "$source_dir" "$cli" "$artifacts" "$3"
    ;;
  coordinator|inline-correction|overflow|decline|abort|metadata|status-error|status-wrong-run|status-malformed|launch-lock|question-off|question-suspended|question-permission)
    node "$repo/pi/tests/t3-adapter/coordinator.mjs" "$source_dir" "$cli" "$artifacts" "$3"
    ;;
  cwd-same|cwd-relative|cwd-symlink|cwd-different|routing-guidance|completion-ack|wait-run-mismatch|observation-error|tool-fence|root-resume|alias-fence|steer|profile-safe|profile-unknown)
    node "$repo/pi/tests/t3-adapter/leaf.mjs" "$source_dir" "$cli" "$artifacts" "$3"
    ;;
  *) printf 'Unknown proof case: %s\n' "$3" >&2; exit 2 ;;
esac

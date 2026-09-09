#!/usr/bin/env bash
# Invoked by setup.sh with the deployed agent directory.
set -euo pipefail
set +x
agent="$1"
auth="$agent/extensions/web-search/auth.json"
[[ ! -e "$auth" && ! -L "$auth" && -f "$HOME/.zshrc" ]] || exit 0
umask 077
stage="$(mktemp "$agent/.search-auth.XXXXXX")"
trap 'rm -f -- "$stage"' EXIT
# Parse literal assignments only. Never execute shell startup code or expansions.
if ! jq -n --rawfile rc "$HOME/.zshrc" '
  reduce ($rc | split("\n")[] |
    capture("^[ \\t]*(?:export[ \\t]+)?(?<name>GOOGLE_SEARCH_API_KEY|GOOGLE_API_KEY|GOOGLE_CSE_ID|GOOGLE_CUSTOM_SEARCH_ENGINE_ID)=(?:\"(?<double>[-A-Za-z0-9_:.]+)\"|\u0027(?<single>[-A-Za-z0-9_:.]+)\u0027|(?<bare>[-A-Za-z0-9_:.]+))[ \\t]*(?:#.*)?$")
  ) as $assignment ({};
    .[$assignment.name] = ($assignment.double // $assignment.single // $assignment.bare)
  ) |
  {
    google_search_api_key: (.GOOGLE_SEARCH_API_KEY // .GOOGLE_API_KEY),
    google_cse_id: (.GOOGLE_CSE_ID // .GOOGLE_CUSTOM_SEARCH_ENGINE_ID)
  } |
  if all(.[]; type == "string" and length > 0) then . else empty end
' > "$stage" 2>/dev/null; then
  printf '%s\n' 'Could not parse Google search credentials from .zshrc.' >&2
  exit 1
fi
[[ -s "$stage" ]] || exit 0
mkdir -p "$(dirname -- "$auth")"
mv "$stage" "$auth"
printf '%s\n' 'Imported Google search credentials from .zshrc into private extension config.' >&2

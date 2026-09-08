#!/usr/bin/env bash
# Invoked only through init.sh --pi, after pinned Node/npm/jq bootstrap.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Reinstall only when the lockfile changes or the executable is missing.
if [[ ! -x "$repo/pi/node_modules/.bin/pi" ]] || ! cmp -s "$repo/pi/package-lock.json" "$repo/pi/node_modules/.portable-lock.json"; then
  npm ci --prefix "$repo/pi" --ignore-scripts --no-audit --no-fund >&2
  cp "$repo/pi/package-lock.json" "$repo/pi/node_modules/.portable-lock.json"
fi
# Bootstrap global Pi only when absent; existing installs update independently.
if [[ -n "${CONFIG_PI_GLOBAL_PREFIX:-}" && "${CONFIG_PI_INSTALL_GLOBAL:-0}" == 1 ]]; then
  npm install --global --prefix "$CONFIG_PI_GLOBAL_PREFIX" --no-audit --no-fund \
    '@earendil-works/pi-coding-agent@latest' >&2
fi
agent="${CONFIG_PI_HOME:-$HOME/.pi}/agent"
mkdir -p "$agent"
chmod 700 "$agent"
stage="$(mktemp -d "$agent/.deploy.XXXXXX")"
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT

# Exact NUL-delimited paths preserve unusual filenames. Capture find failures
# before deployment; process substitution would hide its exit status.
: > "$stage/commands"
if [[ -d "$HOME/.claude/commands" ]]; then
  find -L "$HOME/.claude/commands" -type f -name '*.md' -print0 > "$stage/commands"
fi
find "$repo/pi/agent" -type f ! -path "$repo/pi/agent/settings.json" -print0 > "$stage/resources"

# jq validates flattened command names and generates JSON; Bash owns file IO.
jq --arg modules "$repo/pi/node_modules" --rawfile commands "$stage/commands" '
  def package_path: $modules + ltrimstr("../node_modules");
  ($commands | split("\u0000") | map(select(length > 0))) as $files |
  ($files | map({path: ., name: (split("/")[-1] | rtrimstr(".md"))}) |
    group_by(.name) | map(select(length > 1))) as $duplicates |
  if ($duplicates | length) > 0 then
    $duplicates[0] | error("Duplicate Claude command /\(.[0].name): \(map(.path) | join(" and ")). Rename one to avoid shadowing.")
  else
    .prompts = ((.prompts // []) + $files) |
    .packages |= map(if type == "string" then package_path else .source |= package_path end) |
    .subagents.agentOverrides.researcher.extensions |= map(package_path)
  end
' "$repo/pi/agent/settings.json" > "$stage/settings.json"
mv "$stage/settings.json" "$agent/settings.json"
# Only repository-owned paths are overwritten; never remove private state.
while IFS= read -r -d '' source; do
  relative="${source#"$repo/pi/agent/"}"
  mkdir -p "$(dirname -- "$agent/$relative")"
  cp "$source" "$agent/$relative"
done < "$stage/resources"

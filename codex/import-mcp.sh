#!/usr/bin/env bash
# Invoked through init.sh --codex-mcp. Never print server credentials.
set -euo pipefail
umask 077
command -v jq >/dev/null
command -v codex >/dev/null
source_config="${CONFIG_PI_HOME:-$HOME/.pi}/agent/mcp.json"
home="${CODEX_HOME:-$HOME/.codex}"
target="$home/config.toml"
# Codex accepts stdio command/args/env. Pi adapter metadata is not TOML config.
jq -e '
  .mcpServers | type == "object" and all(.[];
    (.command | type == "string" and length > 0) and .url == null and
    ((.args // []) | type == "array" and all(.[]; type == "string")) and
    ((.env // {}) | type == "object" and all(.[]; type == "string")) and
    ((.literalEnv == true) or ((.env // {}) | all(.[]; test("\\$[A-Za-z_{]") | not)))
  )' "$source_config" >/dev/null || {
  echo 'Expected Pi stdio servers with literal command arguments and environment values.' >&2; exit 1;
}
if [[ -L "$target" || ( -e "$target" && ! -f "$target" ) ]]; then
  echo 'Refusing to replace a symlink or non-file Codex config.' >&2; exit 1
fi
mkdir -p "$home"
stage=$(mktemp -d "$home/.mcp-import.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
if [[ -f "$target" ]]; then cp "$target" "$stage/original"; else : > "$stage/original"; fi
cp "$stage/original" "$stage/config.toml"
chmod 600 "$stage/"*
if ! CODEX_HOME="$stage" codex mcp list --json > "$stage/existing.json" 2> "$stage/error"; then
  echo 'Codex could not parse the existing config; nothing changed.' >&2; exit 1
fi
jq -r '.mcpServers | keys[]' "$source_config" > "$stage/names"
while IFS= read -r name; do
  if jq -e --arg name "$name" 'any(.[]; .name == $name)' "$stage/existing.json" >/dev/null; then
    if jq -e --arg name "$name" --slurpfile pi "$source_config" '
      $pi[0].mcpServers[$name] as $s | .[] | select(.name == $name) |
      .enabled == true and .transport.type == "stdio" and
      .transport.command == $s.command and .transport.args == ($s.args // []) and
      (.transport.env // {}) == ($s.env // {}) and .transport.cwd == null and
      ((.transport.env_vars // []) | length) == 0
    ' "$stage/existing.json" >/dev/null; then continue; fi
    printf 'Codex server %s differs; refusing to overwrite it. Nothing changed.\n' "$name" >&2
    exit 1
  fi
  jq -r --arg name "$name" '
    .mcpServers[$name] as $s |
    "\n[mcp_servers." + ($name|@json) + "]",
    "command = " + ($s.command|@json),
    "args = " + (($s.args // [])|@json),
    "\n[mcp_servers." + ($name|@json) + ".env]",
    (($s.env // {}) | to_entries[] | (.key|@json) + " = " + (.value|@json))
  ' "$source_config" >> "$stage/config.toml"
done < "$stage/names"
if ! CODEX_HOME="$stage" codex mcp list --json > /dev/null 2> "$stage/error"; then
  echo 'Codex rejected the generated config; nothing changed.' >&2; exit 1
fi
if cmp -s "$stage/original" "$stage/config.toml"; then echo 'Codex MCP definitions already match Pi.'; exit 0; fi
if [[ -f "$target" ]]; then
  cmp -s "$target" "$stage/original" || { echo 'Codex config changed during import; nothing written.' >&2; exit 1; }
  backup=$(mktemp "$home/config.toml.before-pi-mcp.XXXXXX")
  cp "$stage/original" "$backup"
  chmod 600 "$backup"
  printf 'Backup: %s\n' "$backup"
fi
mv "$stage/config.toml" "$target"
printf 'Copied Pi MCP definitions to %s\n' "$target"

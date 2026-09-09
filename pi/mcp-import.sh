#!/usr/bin/env bash
set +x
set -euo pipefail
agent="${1:?Pi agent directory required}"
source="$HOME/.claude.json"
target="$agent/mcp.json"
[[ ! -L "$target" ]] || exit 0
if [[ -e "$target" ]]; then
  jq -e 'type == "object" and ((.mcpServers // {}) | type == "object")' "$target" >/dev/null 2>&1 || {
    printf '%s\n' 'Cannot import Grafana: Pi mcp.json must contain a JSON object.' >&2
    exit 1
  }
  if jq -e '(.mcpServers // {}) | has("grafana")' "$target" >/dev/null; then exit 0; fi
fi
[[ -f "$source" ]] || exit 0
if ! jq -e '.mcpServers.grafana | type == "object"' "$source" >/dev/null 2>&1; then exit 0; fi
umask 077
stage="$(mktemp -d "$agent/.mcp-import.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
if [[ -f "$target" ]]; then cp "$target" "$stage/base.json"; else printf '{}\n' > "$stage/base.json"; fi
if ! jq --slurpfile base "$stage/base.json" '
  .mcpServers.grafana as $server |
  if $server.command != "docker" or (($server.args // []) | type != "array") or
    (all($server.args[]; type == "string") | not) or
    (($server.env // {}) | type != "object") then
    error("Expected a Docker stdio Grafana configuration")
  else
    reduce range(0; $server.args | length) as $i
      ({args: [], env: ($server.env // {})};
        $server.args[$i] as $arg |
        if $i > 0 and ($server.args[$i - 1] == "-e" or $server.args[$i - 1] == "--env") and
          ($arg | test("^[A-Za-z_][A-Za-z0-9_]*=")) then
          ($arg | index("=")) as $equals |
          .args += [$arg[:$equals]] | .env[$arg[:$equals]] = $arg[$equals + 1:]
        else .args += [$arg] end) as $docker |
    $base[0] | .mcpServers.grafana = ($server + $docker + {
      lifecycle: "lazy", directTools: false, literalEnv: true
    } | del(.type))
  end
' "$source" > "$stage/mcp.json" 2> "$stage/error"; then
  printf '%s\n' 'Cannot import Grafana: expected a valid Docker stdio definition in Claude config.' >&2
  exit 1
fi
chmod 600 "$stage/mcp.json"
mv "$stage/mcp.json" "$target"
printf '%s\n' 'Imported Grafana MCP into private Pi config; Claude config unchanged.' >&2

#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/tests/common.sh"
agent="$CONFIG_PI_HOME/agent"
mkdir -p "$test_dir/bin"
cat > "$test_dir/bin/docker" <<'SERVER'
#!/usr/bin/env bash
set -euo pipefail
[[ "${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}" == 'fixture-token' ]] || exit 1
while IFS= read -r request; do
  if ! jq -e 'has("id")' <<< "$request" >/dev/null; then continue; fi
  jq -c '
    {jsonrpc: "2.0", id: .id, result:
      (if .method == "initialize" then
        {protocolVersion: .params.protocolVersion, capabilities: {tools: {}}, serverInfo: {name: "fixture", version: "1"}}
      elif .method == "tools/list" then
        {tools: [{name: "fixture_echo", description: "Echo test input", inputSchema: {type: "object", properties: {message: {type: "string"}}, required: ["message"]}}]}
      elif .method == "tools/call" then
        {content: [{type: "text", text: .params.arguments.message}]}
      else {} end)}
  ' <<< "$request"
done
SERVER
chmod +x "$test_dir/bin/docker"
export PATH="$test_dir/bin:$PATH"
jq -n '{mcpServers: {grafana: {type: "stdio", command: "docker", args: ["run", "--rm", "-i", "-e", "GRAFANA_URL=https://fixture.invalid", "-e", "GRAFANA_SERVICE_ACCOUNT_TOKEN=fixture-token", "fixture/mcp", "-t", "stdio"]}}}' > "$HOME/.claude.json"
cp "$HOME/.claude.json" "$test_dir/claude.expected"
printf '%s\n' '{"settings":{"idleTimeout":3},"mcpServers":{"other":{"command":"unused","disabled":true}}}' > "$agent/mcp.json"
"$repo/init.sh" --pi
cmp -s "$HOME/.claude.json" "$test_dir/claude.expected" || fail 'Claude config modified'
jq -e '.settings.idleTimeout == 3 and .mcpServers.other.disabled == true and
  .mcpServers.grafana.lifecycle == "lazy" and .mcpServers.grafana.literalEnv == true and
  .mcpServers.grafana.env.GRAFANA_SERVICE_ACCOUNT_TOKEN == "fixture-token" and
  (.mcpServers.grafana.args | all(.[]; contains("=") | not))' "$agent/mcp.json" >/dev/null || fail 'Grafana import mismatch'
[[ "$(ls -l "$agent/mcp.json")" == -rw-------* ]] || fail 'MCP config permissions'
cp "$agent/mcp.json" "$test_dir/mcp.expected"
printf '{}\n' > "$HOME/.claude.json"
bash "$repo/pi/mcp-import.sh" "$agent"
cmp -s "$agent/mcp.json" "$test_dir/mcp.expected" || fail 'Existing MCP config overwritten'
mkdir "$test_dir/symlink-agent"
ln -s "$test_dir/missing-target" "$test_dir/symlink-agent/mcp.json"
bash "$repo/pi/mcp-import.sh" "$test_dir/symlink-agent"
[[ -L "$test_dir/symlink-agent/mcp.json" && ! -e "$test_dir/missing-target" ]] || fail 'MCP symlink replaced'
printf '%s\n' '{"mcpServers":{"untrusted":{"command":"should-never-run","lifecycle":"eager"}}}' > .mcp.json
PI_CODING_AGENT_DIR="$agent" node "$repo/pi/tests/mcp-fixture.mjs"
printf '%s\n' 'PASS: Grafana private import, credential env transfer, preservation and permissions'

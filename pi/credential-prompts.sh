#!/usr/bin/env bash
set +x
set -euo pipefail
agent="${1:?Pi agent directory required}"
[[ "${CONFIG_PI_NO_PROMPT:-0}" != 1 && -t 0 && -t 2 ]] || exit 0
umask 077
stage="$(mktemp -d "$agent/.credentials.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT

prompt() {
  local name="$1" description="$2" url="$3" entered=''
  [[ -z "${!name:-}" ]] || return 0
  IFS= read -r -s -p "$name: $description. $url (Enter skips): " entered || entered=''
  printf '\n' >&2
  printf -v "$name" '%s' "$entered"
}

search="$agent/extensions/web-search/auth.json"
if [[ ! -L "$search" ]]; then
  if [[ -f "$search" ]]; then
    cp "$search" "$stage/search.json"
  else
    printf '{}\n' > "$stage/search.json"
  fi
  if jq -e 'type == "object"' "$stage/search.json" >/dev/null 2>&1; then
    GOOGLE_SEARCH_API_KEY="${GOOGLE_SEARCH_API_KEY:-${GOOGLE_API_KEY:-}}"
    GOOGLE_CSE_ID="${GOOGLE_CSE_ID:-${GOOGLE_CUSTOM_SEARCH_ENGINE_ID:-}}"
    [[ -n "$GOOGLE_SEARCH_API_KEY" ]] || GOOGLE_SEARCH_API_KEY="$(jq -r '.google_search_api_key // empty' "$stage/search.json")"
    [[ -n "$GOOGLE_CSE_ID" ]] || GOOGLE_CSE_ID="$(jq -r '.google_cse_id // empty' "$stage/search.json")"
    if [[ -f "$HOME/.zshrc" ]]; then
      jq -n --rawfile rc "$HOME/.zshrc" '
        reduce ($rc | split("\n")[] |
          capture("^[ \\t]*(?:export[ \\t]+)?(?<name>GOOGLE_SEARCH_API_KEY|GOOGLE_API_KEY|GOOGLE_CSE_ID|GOOGLE_CUSTOM_SEARCH_ENGINE_ID)=(?:\"(?<double>[-A-Za-z0-9_:.]+)\"|\u0027(?<single>[-A-Za-z0-9_:.]+)\u0027|(?<bare>[-A-Za-z0-9_:.]+))[ \\t]*(?:#.*)?$")
        ) as $assignment ({}; .[$assignment.name] = ($assignment.double // $assignment.single // $assignment.bare))
      ' > "$stage/shell.json"
      [[ -n "$GOOGLE_SEARCH_API_KEY" ]] || GOOGLE_SEARCH_API_KEY="$(jq -r '.GOOGLE_SEARCH_API_KEY // .GOOGLE_API_KEY // empty' "$stage/shell.json")"
      [[ -n "$GOOGLE_CSE_ID" ]] || GOOGLE_CSE_ID="$(jq -r '.GOOGLE_CSE_ID // .GOOGLE_CUSTOM_SEARCH_ENGINE_ID // empty' "$stage/shell.json")"
    fi
    prompt GOOGLE_SEARCH_API_KEY 'Google API key' 'https://console.cloud.google.com/apis/credentials'
    prompt GOOGLE_CSE_ID 'Search engine ID' 'https://programmablesearchengine.google.com/controlpanel/all'
    if [[ -n "$GOOGLE_SEARCH_API_KEY" && -n "$GOOGLE_CSE_ID" ]] &&
      jq -e '(.google_search_api_key // "") == "" or (.google_cse_id // "") == ""' "$stage/search.json" >/dev/null; then
      GOOGLE_SEARCH_API_KEY="$GOOGLE_SEARCH_API_KEY" GOOGLE_CSE_ID="$GOOGLE_CSE_ID" jq '
        if (.google_search_api_key // "") == "" and env.GOOGLE_SEARCH_API_KEY != "" then .google_search_api_key = env.GOOGLE_SEARCH_API_KEY else . end |
        if (.google_cse_id // "") == "" and env.GOOGLE_CSE_ID != "" then .google_cse_id = env.GOOGLE_CSE_ID else . end
      ' "$stage/search.json" > "$stage/search.new.json"
      mkdir -p "$(dirname -- "$search")"
      chmod 600 "$stage/search.new.json"
      mv "$stage/search.new.json" "$search"
    fi
  fi
fi

mcp="$agent/mcp.json"
[[ ! -L "$mcp" ]] || exit 0
if [[ -f "$mcp" ]]; then cp "$mcp" "$stage/mcp.json"; else printf '{}\n' > "$stage/mcp.json"; fi
jq -e 'type == "object" and ((.mcpServers // {}) | type == "object")' "$stage/mcp.json" >/dev/null 2>&1 || exit 0
jq -e '.mcpServers.grafana == null or
  (.mcpServers.grafana.command == "docker" and .mcpServers.grafana.literalEnv == true and
   (.mcpServers.grafana.args | index("GRAFANA_SERVICE_ACCOUNT_TOKEN") != null))' "$stage/mcp.json" >/dev/null || exit 0
saved_url="$(jq -r '.mcpServers.grafana.env.GRAFANA_URL // empty' "$stage/mcp.json")"
saved_token="$(jq -r '.mcpServers.grafana.env.GRAFANA_SERVICE_ACCOUNT_TOKEN // empty' "$stage/mcp.json")"
GRAFANA_URL="${saved_url:-${GRAFANA_URL:-}}"
GRAFANA_SERVICE_ACCOUNT_TOKEN="${saved_token:-${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}}"
prompt GRAFANA_URL 'Grafana instance URL' 'https://grafana.com/profile/org'
prompt GRAFANA_SERVICE_ACCOUNT_TOKEN 'Grafana service-account token' 'https://grafana.com/docs/grafana/latest/administration/service-accounts/'
if [[ -n "$GRAFANA_URL" && -n "$GRAFANA_SERVICE_ACCOUNT_TOKEN" ]] &&
  jq -e '(.mcpServers.grafana.env.GRAFANA_URL // "") == "" or (.mcpServers.grafana.env.GRAFANA_SERVICE_ACCOUNT_TOKEN // "") == ""' "$stage/mcp.json" >/dev/null; then
  GRAFANA_URL="$GRAFANA_URL" GRAFANA_SERVICE_ACCOUNT_TOKEN="$GRAFANA_SERVICE_ACCOUNT_TOKEN" jq '
    .mcpServers.grafana //= {command: "docker", args: ["run", "--rm", "-i", "-e", "GRAFANA_URL", "-e", "GRAFANA_SERVICE_ACCOUNT_TOKEN", "mcp/grafana@sha256:9bf3f866661a605cfb009a0f0080d7ae13c4f794bf485b41eb664a1141776aaf", "-t", "stdio"], lifecycle: "lazy", directTools: false, literalEnv: true} |
    if (.mcpServers.grafana.env.GRAFANA_URL // "") == "" and env.GRAFANA_URL != "" then .mcpServers.grafana.env.GRAFANA_URL = env.GRAFANA_URL else . end |
    if (.mcpServers.grafana.env.GRAFANA_SERVICE_ACCOUNT_TOKEN // "") == "" and env.GRAFANA_SERVICE_ACCOUNT_TOKEN != "" then .mcpServers.grafana.env.GRAFANA_SERVICE_ACCOUNT_TOKEN = env.GRAFANA_SERVICE_ACCOUNT_TOKEN else . end
  ' "$stage/mcp.json" > "$stage/mcp.new.json"
  chmod 600 "$stage/mcp.new.json"
  mv "$stage/mcp.new.json" "$mcp"
fi

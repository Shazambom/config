# Import Pi MCP definitions

Run `./init.sh --codex-mcp` to copy Pi's private stdio MCP definitions into
Codex's `config.toml`. It reads `${CONFIG_PI_HOME:-$HOME/.pi}/agent/mcp.json`
and writes under `${CODEX_HOME:-$HOME/.codex}`. Requires the existing Codex CLI
and jq. Ordinary Pi setup does not change Codex configuration.

The importer copies command, arguments and literal environment values. It omits
Pi adapter metadata, validates the generated TOML with Codex, preserves existing
settings, and creates a private backup before replacement. Matching servers are
left unchanged; conflicting names fail without changing the target. Unsupported
transports or environment expansion require separate conversion rather than a
silent partial import. Credentials remain in private configuration, never here.

Run `bash codex/test-mcp-import.sh` for isolated tests using fake credentials.
Restart Codex after importing to load the new servers.

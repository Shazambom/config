# Pi to Codex MCP configuration

Pi's adapter JSON uses `mcpServers`; Codex expects `[mcp_servers.NAME]` TOML
with command, args and env for stdio servers. Pi-only lifecycle/direct-tool
metadata is not a Codex setting. Preserve literal environment values without
printing them or putting them in process arguments.

`init.sh --codex-mcp` invokes `codex/import-mcp.sh` explicitly. Ordinary setup
does not synchronize unrelated applications. The importer stages a copy, checks
it with native `codex mcp list`, preserves existing TOML bytes, refuses name
conflicts, and makes a mode-0600 backup before replacement.

A test exposed that `mv file existing-directory` succeeds by moving the file
inside the directory. Reject non-file and symlink targets before staging; do not
interpret a successful move as proof the intended config was replaced.

Verification: `bash codex/test-mcp-import.sh` checks native TOML parsing, escaped
arguments/environment values, unrelated settings, idempotence and refusal paths.
The real import independently compared parsed TOML with Pi and the backup, then
initialized the copied Grafana transport and listed 65 tools. That is server
startup/discovery proof, not a live Codex model's use of a Grafana tool.

The importer covers literal stdio definitions. Do not generalize it to HTTP/OAuth
or environment interpolation without implementing and testing those conversions.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createMcpAdapter } from "../node_modules/pi-mcp-adapter/index.ts";

export default function (pi: ExtensionAPI) {
  let config = { mcpServers: {}, settings: {} };
  try {
    config = JSON.parse(readFileSync(join(getAgentDir(), "mcp.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("Cannot read Pi's private mcp.json; check its permissions and JSON syntax.");
    }
  }
  return createMcpAdapter({
    config: {
      ...config,
      settings: { scriptMode: false, sampling: false, ...config.settings },
    },
  })(pi);
}

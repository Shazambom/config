import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("resources_discover", (event, ctx) => {
    if (!ctx.isProjectTrusted() || process.argv.includes("--no-skills")) return;

    const skillPaths: string[] = [];
    let directory = resolve(event.cwd);
    while (true) {
      const skills = join(directory, ".claude", "skills");
      try {
        if (statSync(skills).isDirectory()) skillPaths.push(skills);
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
      const parent = dirname(directory);
      if (existsSync(join(directory, ".git")) || parent === directory) break;
      directory = parent;
    }
    return { skillPaths };
  });
}

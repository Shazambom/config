import { existsSync, readFileSync, statSync } from "node:fs";
import { Type } from "typebox";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "load_workflow",
    label: "Load workflow",
    description: "Load an explicitly named skill or prompt from Pi's discovered index. Use /tdd for a prompt, /skill:name for a skill, or an unambiguous bare name. Returns the exact source path and complete unchanged file. Does not execute instructions or search folders.",
    promptSnippet: "Resolve and read a named skill or prompt without guessing paths",
    promptGuidelines: ["Use load_workflow for named skills or slash workflows; never construct a SKILL.md path from a workflow name."],
    parameters: Type.Object({
      name: Type.String({ description: "Exact workflow name, /prompt, or /skill:name" }),
      kind: Type.Optional(Type.String({ enum: ["skill", "prompt"], description: "Disambiguate a bare name" })),
    }),
    async execute(_id, params) {
      let name = params.name;
      let kind = params.kind;
      if (name.startsWith("/skill:")) {
        if (kind && kind !== "skill") throw new Error("/skill:name requires kind skill");
        kind = "skill";
        name = name.slice(7);
      } else if (name.startsWith("/")) {
        if (kind && kind !== "prompt") throw new Error("/name requires kind prompt");
        kind = "prompt";
        name = name.slice(1);
      }
      if (!name || /\s/.test(name)) throw new Error("Supply one exact workflow name without arguments");
      // Keep Pi's precedence within each resource kind. Never inspect extension sources.
      const matches = new Map<string, ReturnType<typeof pi.getCommands>[number]>();
      for (const command of pi.getCommands()) {
        if (command.source !== "skill" && command.source !== "prompt") continue;
        if (kind && command.source !== kind) continue;
        const candidate = command.source === "skill" ? command.name.slice(6) : command.name;
        if (candidate === name && !matches.has(command.source)) matches.set(command.source, command);
      }
      if (!matches.size) throw new Error(`Workflow not found in the discovered index: ${params.name}`);
      if (matches.size > 1) throw new Error(`Ambiguous workflow ${name}; specify kind skill or prompt`);
      const command = [...matches.values()][0];
      const path = command.sourceInfo.path;
      const content = readFileSync(path, "utf8");
      const details = { kind: command.source, name, path, baseDir: dirname(path), content };
      return {
        content: [{ type: "text", text: `Kind: ${details.kind}\nName: ${name}\nPath: ${path}\nRelative references: ${details.baseDir}\n\n${content}` }],
        details,
      };
    },
  });

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

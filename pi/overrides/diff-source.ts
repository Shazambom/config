import { spawnSync } from "node:child_process";
import {
  parseDiffSource as parseUpstream,
  getDiff as getUpstream,
  DIFF_MAX_BUFFER_BYTES,
} from "./source-upstream.ts";
import type { DiffSource } from "../review/types.ts";

export { DIFF_MAX_BUFFER_BYTES };

type PortableSource = DiffSource & { everything?: boolean };

export function parseDiffSource(args: string): PortableSource {
  const source: PortableSource = parseUpstream(args.trim() === "h" ? "HEAD" : args);
  if (source.args.length === 0) {
    source.everything = true;
    source.label = "all changes";
    source.promptLabel = "all branch and working-tree changes, including untracked files";
  }
  return source;
}

function git(cwd: string, args: string[], allowed = [0]): string {
  const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    input: "",
    maxBuffer: DIFF_MAX_BUFFER_BYTES,
    timeout: 30_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status ?? -1)) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed: ${result.status}`);
  }
  return result.stdout;
}

export function getDiff(cwd: string, source: PortableSource): string {
  if (!source.everything) return getUpstream(cwd, source);

  const root = git(cwd, ["rev-parse", "--show-toplevel"]).replace(/\r?\n$/, "");
  const head = git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], [0, 1]).trim();
  let base: string;
  let label: string;
  if (!head) {
    base = git(root, ["hash-object", "-t", "tree", "--stdin"]).trim();
    label = "empty tree, no commits yet";
  } else {
    const mainRef = ["refs/heads/main", "refs/remotes/origin/main"].find(ref =>
      git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], [0, 1]).trim(),
    );
    base = mainRef ? git(root, ["merge-base", mainRef, head]).trim() : head;
    label = mainRef ? `merge base of ${mainRef} and HEAD` : "HEAD; no main or origin/main found";
  }
  source.label = `All changes against ${label}, including untracked files`;
  source.promptLabel = `${source.label} (${base})`;
  if (source.turnBased) source.label += " with turn-based review overlay";

  const flags = ["--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", "--unified=3"];
  const chunks = [git(root, ["diff", ...flags, base, "--"])];
  let bytes = Buffer.byteLength(chunks[0]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const path of untracked.split("\0").filter(Boolean)) {
    if (/[\x00-\x1f\x7f]/.test(path)) {
      throw new Error(`The review UI cannot safely annotate control characters in filenames: ${JSON.stringify(path)}. Use explicit /diff arguments to review tracked changes.`);
    }
    const patch = git(root, ["diff", ...flags, "--no-index", "--", "/dev/null", path], [0, 1]);
    bytes += Buffer.byteLength(patch);
    if (bytes > DIFF_MAX_BUFFER_BYTES) {
      throw new Error("Diff exceeds 128 MiB. Use explicit /diff arguments or /view to narrow the review.");
    }
    chunks.push(patch);
  }
  return chunks.join("");
}

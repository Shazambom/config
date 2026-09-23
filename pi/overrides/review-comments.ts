import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { truncateHead, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WorkspaceCommentStore, type WorkspaceCommentRecord } from "./review/workspace-comments.ts";
import type { ReviewComment, ReviewLine } from "./review/types.ts";
import { getCachedComments } from "./review/cache.ts";

const ENTRY = "pi-diff-review-comments-v2";
type SessionComments = { cacheKey: string; comments: ReviewComment[] };
type Identified = ReviewComment | WorkspaceCommentRecord;

function sessionComments(ctx: ExtensionContext): Map<string, ReviewComment[]> {
  const scopes = new Map<string, ReviewComment[]>();
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
    const data = entry.data as SessionComments;
    if (typeof data?.cacheKey === "string" && data.cacheKey.startsWith(`${ctx.cwd}\0`) && Array.isArray(data.comments)) scopes.set(data.cacheKey, data.comments);
  }
  for (const [cacheKey, comments] of scopes) {
    scopes.set(cacheKey, comments.map(comment => ({ ...comment })));
  }
  return scopes;
}

function checkRevision(record: Identified | undefined, expected: Identified): asserts record is Identified {
  if (!record || record.revision !== expected.revision || record.disposition !== "open") {
    throw new Error("Review comment changed or was resolved. Reopen the review and inspect the current comment before editing or submitting it.");
  }
}

function identity(comment: ReviewComment): ReviewComment {
  return { ...comment, reviewId: randomUUID(), revision: randomUUID(), disposition: "open", submittedRevision: undefined };
}

export function registerReviewComments(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "review_comments",
    label: "Review comments",
    description: "List submitted review comments in this workspace/session or resolve one after addressing it. Resolution requires its exact id and revision from feedback or list. Drafts cannot be resolved. List output is limited to 50KB/2000 lines; use id to inspect a specific comment if truncated.",
    promptSnippet: "List or resolve submitted /view and /diff comments",
    promptGuidelines: ["After addressing each /view or /diff comment, call review_comments with action resolve and its exact id and revision. Do not resolve comments merely to acknowledge them; leave unaddressed comments open."],
    parameters: Type.Object({
      action: StringEnum(["list", "resolve"] as const),
      id: Type.Optional(Type.String({ minLength: 1 })),
      revision: Type.Optional(Type.String({ minLength: 1 })),
      includeResolved: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const store = new WorkspaceCommentStore(ctx.cwd);
      const scopes = sessionComments(ctx);
      const workspace = store.list();
      if (params.action === "resolve") {
        if (!params.id || !params.revision) throw new Error("resolve requires one id and its exact revision; no comments were changed.");
        const resolveRecord = (record: Identified | undefined) => {
          if (!record) throw new Error("Review comment not found in this workspace/session.");
          if (record.revision !== params.revision) throw new Error("Review comment revision conflict. Inspect the current feedback; no comments were changed.");
          if (record.submittedRevision !== record.revision) throw new Error("This comment is an unsubmitted draft; no comments were changed.");
          if (record.disposition !== "open") throw new Error("Review comment is not open; no comments were changed.");
          record.disposition = "resolved";
        };
        if (workspace.some(record => record.reviewId === params.id)) {
          store.update(records => resolveRecord(records.find(record => record.reviewId === params.id)));
        } else {
          const scope = [...scopes].find(([, comments]) => comments.some(comment => comment.reviewId === params.id));
          if (!scope) throw new Error("Review comment not found in this workspace/session.");
          resolveRecord(scope[1].find(comment => comment.reviewId === params.id));
          pi.appendEntry(ENTRY, { cacheKey: scope[0], comments: scope[1] });
        }
        return { content: [{ type: "text", text: `Resolved review comment ${params.id} revision ${params.revision}.` }], details: { id: params.id, revision: params.revision, disposition: "resolved" } };
      }
      const records = [...workspace, ...[...scopes.values()].flat()]
        .filter(record => record.submittedRevision === record.revision && record.submittedRevision && record.disposition !== "deleted")
        .filter(record => params.includeResolved || record.disposition === "open")
        .filter(record => !params.id || record.reviewId === params.id)
        .map(record => ({ id: record.reviewId, revision: record.revision, disposition: record.disposition, filePath: record.filePath, text: record.text }));
      const output = truncateHead(JSON.stringify(records, null, 2));
      return { content: [{ type: "text", text: output.content + (output.truncated ? "\nList truncated. Query one id to inspect it." : "") }], details: { count: records.length, truncated: output.truncated } };
    },
  });
}

export class ReviewComments {
  private session: ReviewComment[];
  private baseline = new Map<string, ReviewComment>();

  constructor(private pi: ExtensionAPI, private ctx: ExtensionContext, private cacheKey: string, private lines: ReviewLine[], private store: WorkspaceCommentStore) {
    const saved = sessionComments(ctx).get(cacheKey);
    this.session = saved ?? [];
    if (!saved) {
      const workspace = store.list();
      for (const comment of getCachedComments(ctx as never, cacheKey).values()) {
        const inWorkspace = workspace.some(record => record.filePath === comment.filePath && record.startLine === comment.startNewLineNumber && record.endLine === comment.endNewLineNumber);
        if (!inWorkspace) this.session.push(identity(comment));
      }
      this.persistSession();
    }
  }

  load(): Map<string, ReviewComment> {
    this.session = sessionComments(this.ctx).get(this.cacheKey) ?? this.session;
    const comments = this.store.getVisibleComments(this.lines);
    for (const comment of this.session) {
      if (comment.disposition === "open") comments.set(comment.id, { ...comment });
    }
    this.baseline = new Map([...comments].map(([key, comment]) => [key, { ...comment }]));
    return comments;
  }

  save(comments: Map<string, ReviewComment>): Map<string, ReviewComment> {
    const keys = new Set([...this.baseline.keys(), ...comments.keys()]);
    const changed = [...keys].filter(key => this.baseline.get(key)?.text !== comments.get(key)?.text);
    if (!changed.length) return new Map([...this.baseline].map(([key, comment]) => [key, { ...comment }]));
    const nextSession = (sessionComments(this.ctx).get(this.cacheKey) ?? this.session).map(comment => ({ ...comment }));
    this.store.update(records => {
      for (const key of changed) {
        const previous = this.baseline.get(key);
        const incoming = comments.get(key);
        const workspaceIndex = previous ? records.findIndex(record => record.reviewId === previous.reviewId) : -1;
        const existing = previous && (records[workspaceIndex] ?? nextSession.find(record => record.reviewId === previous.reviewId));
        if (previous) checkRevision(existing, previous);
        if (!incoming) {
          if (existing) existing.disposition = "deleted";
          continue;
        }
        const updated = previous
          ? { ...incoming, reviewId: previous.reviewId, revision: randomUUID(), disposition: "open" as const, submittedRevision: undefined }
          : identity(incoming);
        const record = this.store.buildRecord(this.lines, updated, workspaceIndex >= 0 ? records[workspaceIndex] : undefined);
        if (workspaceIndex >= 0 && !record) throw new Error("Unable to read the commented file. Restore it or reopen the review before editing this comment.");
        if (!record || (previous && workspaceIndex < 0)) {
          const index = nextSession.findIndex(comment => comment.reviewId === previous?.reviewId);
          if (index >= 0) nextSession[index] = updated;
          else nextSession.push(updated);
          continue;
        }
        if (workspaceIndex >= 0) {
          records[workspaceIndex] = record;
          continue;
        }
        if (records.some(existing => {
          if (existing.disposition !== "open" || existing.filePath !== record.filePath) return false;
          const location = this.store.locateComment(existing);
          return location.resolvedStartLine === record.startLine && location.resolvedEndLine === record.endLine;
        })) {
          throw new Error("A comment was added at this location in another review. Reopen before editing it.");
        }
        records.push(record);
      }
    });
    this.session = nextSession;
    this.persistSession();
    return this.load();
  }

  submit(comments: ReviewComment[]): ReviewComment[] {
    if (!comments.length) return [];
    const session = (sessionComments(this.ctx).get(this.cacheKey) ?? this.session).map(comment => ({ ...comment }));
    this.store.update(records => {
      for (const comment of comments) {
        const record = records.find(record => record.reviewId === comment.reviewId) ?? session.find(record => record.reviewId === comment.reviewId);
        checkRevision(record, comment);
        record.submittedRevision = record.revision;
      }
    });
    this.session = session;
    this.persistSession();
    return comments.map(comment => ({ ...comment, submittedRevision: comment.revision }));
  }

  private persistSession(): void {
    this.pi.appendEntry(ENTRY, { cacheKey: this.cacheKey, comments: this.session } satisfies SessionComments);
  }
}

export function resolutionInstructions(comments: ReviewComment[]): string {
  return "\n\nAfter addressing each comment, call review_comments with action=resolve and that comment's exact id and revision below. Do not resolve an unaddressed comment.\n" + comments.map(comment => `[review_comment id=${comment.reviewId} revision=${comment.revision}]\n${comment.filePath}: ${comment.text}`).join("\n\n");
}

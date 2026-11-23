import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, desc, eq, gte, lt, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AppError, isId } from "@tickzy/shared";
import { schema, withWorkspace, type Db } from "@tickzy/db";
import { requireMember, WorkspaceHeader } from "../../http/auth.ts";

const Entry = z.object({
  id: z.string(),
  actor_type: z.string(),
  actor_id: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

/**
 * Opaque cursor = base64url(last id). Audit ids are time-ordered ULIDs, so keyset paging on `id` is exact
 * (a timestamp cursor would lose Postgres' microsecond precision in a JS Date and could skip rows).
 */
function encodeCursor(id: string): string {
  return Buffer.from(id).toString("base64url");
}
function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!isId(id, "auditLog")) throw new AppError("validation_failed", "Invalid cursor", [{ path: "query.cursor", issue: "invalid" }]);
  return id;
}

/** GET /v1/audit-log (FR-1.7, T-104): newest first, filter by actor/action/date, keyset pagination. */
export function auditRoutes(db: Db) {
  return async function routes(app: FastifyInstance): Promise<void> {
    app.withTypeProvider<ZodTypeProvider>().get("/v1/audit-log", {
      schema: {
        tags: ["audit"],
        summary: "Audit log of administrative and data-access actions",
        headers: WorkspaceHeader,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
          actor_id: z.string().optional(),
          action: z.string().max(100).optional(),
          from: z.iso.datetime().optional(),
          to: z.iso.datetime().optional(),
        }),
        response: { 200: z.object({ data: z.array(Entry), next_cursor: z.string().nullable() }) },
      },
    }, async (req) => {
      const m = await requireMember(db, req, "audit:read");
      const q = req.query;
      const a = schema.auditLog;
      const conds: SQL[] = [];
      if (q.actor_id) conds.push(eq(a.actorId, q.actor_id));
      if (q.action) conds.push(eq(a.action, q.action));
      if (q.from) conds.push(gte(a.createdAt, new Date(q.from)));
      if (q.to) conds.push(lte(a.createdAt, new Date(q.to)));
      if (q.cursor) conds.push(lt(a.id, decodeCursor(q.cursor)));
      const rows = await withWorkspace(db, m, (tx) =>
        tx.select().from(a).where(conds.length ? and(...conds) : undefined).orderBy(desc(a.id)).limit(q.limit + 1),
      );
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        data: page.map((r) => ({
          id: r.id, actor_type: r.actorType, actor_id: r.actorId, action: r.action, target_type: r.targetType,
          target_id: r.targetId, metadata: r.metadata, created_at: r.createdAt.toISOString(),
        })),
        next_cursor: rows.length > q.limit && last ? encodeCursor(last.id) : null,
      };
    });
  };
}

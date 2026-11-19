import { eq, sql } from "drizzle-orm";
import { AppError, newId } from "@tickzy/shared";
import { schema, withUser, withWorkspace, type Db, type Tx } from "@tickzy/db";

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  issue_prefix: string;
  region: "us" | "eu";
  created_at: string;
}

function toDto(w: typeof schema.workspaces.$inferSelect): WorkspaceDto {
  return { id: w.id, name: w.name, slug: w.slug, issue_prefix: w.issuePrefix, region: w.region, created_at: w.createdAt.toISOString() };
}

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } }).cause ?? (err as { code?: string; constraint?: string });
  return cause?.code === "23505" && (constraint === undefined || cause.constraint === constraint);
}

async function audit(tx: Tx, ws: string, userId: string, action: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await tx.insert(schema.auditLog).values({
    id: newId("auditLog"), workspaceId: ws, actorType: "user", actorId: userId, action, targetType: "workspace", targetId: ws, metadata,
  });
}

export function createWorkspaceService(db: Db) {
  return {
    async create(userId: string, input: { name: string; slug: string; issue_prefix: string }): Promise<WorkspaceDto> {
      const id = newId("workspace");
      try {
        return await withWorkspace(db, { workspaceId: id, userId }, async (tx) => {
          const [ws] = await tx
            .insert(schema.workspaces)
            .values({ id, name: input.name, slug: input.slug, issuePrefix: input.issue_prefix })
            .returning();
          await tx.insert(schema.memberships).values({ id: newId("membership"), workspaceId: id, userId, role: "admin" });
          await tx.insert(schema.workspaceCounters).values({ workspaceId: id, name: "issue", value: 0 });
          await audit(tx, id, userId, "workspace.created", { slug: input.slug });
          await tx.insert(schema.outbox).values({ workspaceId: id, type: "workspace.created", payload: { workspace_id: id } });
          return toDto(ws!);
        });
      } catch (err) {
        if (isUniqueViolation(err, "workspaces_slug_key")) throw new AppError("conflict", "Slug is already taken");
        throw err;
      }
    },

    async get(workspaceId: string, userId: string): Promise<WorkspaceDto> {
      const ws = await withWorkspace(db, { workspaceId, userId }, (tx) => tx.select().from(schema.workspaces).limit(1));
      if (!ws[0]) throw new AppError("not_found", "Workspace not found");
      return toDto(ws[0]);
    },

    async update(workspaceId: string, userId: string, patch: { name?: string | undefined; issue_prefix?: string | undefined }): Promise<WorkspaceDto> {
      return withWorkspace(db, { workspaceId, userId }, async (tx) => {
        const values: Partial<typeof schema.workspaces.$inferInsert> = { updatedAt: new Date() };
        if (patch.name !== undefined) values.name = patch.name;
        if (patch.issue_prefix !== undefined) values.issuePrefix = patch.issue_prefix;
        const [ws] = await tx.update(schema.workspaces).set(values).where(eq(schema.workspaces.id, workspaceId)).returning();
        if (!ws) throw new AppError("not_found", "Workspace not found");
        await audit(tx, workspaceId, userId, "workspace.updated", { fields: Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined) });
        return toDto(ws);
      });
    },

    async listMine(userId: string) {
      const res = await withUser(db, userId, (tx) => tx.execute(sql`SELECT * FROM my_memberships()`));
      return res.rows.map((r) => ({
        workspace_id: String(r.workspace_id), name: String(r.workspace_name), slug: String(r.workspace_slug), role: String(r.role),
      }));
    },
  };
}

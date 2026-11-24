import { and, asc, eq, sql } from "drizzle-orm";
import { AppError, newId, viewListQuery, type Priority, type SystemViewId, type ViewFilters, type ViewSort } from "@tickzy/shared";
import { schema, withWorkspace, type ChannelKind, type Db, type Tx } from "@tickzy/db";
import type { MemberContext } from "../../http/auth.ts";
import { can } from "../../permissions.ts";
import { countIssues } from "../issues/service.ts";
import { isUniqueViolation } from "../../lib/pg-errors.ts";

/**
 * Saved views (T-211, FR-3.7). A view is a system view + filters + sort (the inbox URL state). Personal views are
 * visible only to their owner and shared views to every member — both enforced by RLS (0012). Shared views can be
 * created by people who can edit issues; changed or deleted by their owner or an admin (audited).
 */
export interface SavedViewDto {
  id: string; name: string; shared: boolean; base: SystemViewId; filters: ViewFilters; sort: ViewSort; position: number;
  owner_user_id: string; owner_name: string | null;
  /** Issues currently matching the view. */
  count: number;
  /** Whether the caller may rename, re-filter, share/unshare or delete it. */
  can_edit: boolean;
  created_at: string; updated_at: string;
}
export interface ViewInput { name?: string; shared?: boolean; base?: SystemViewId; filters?: ViewFilters; sort?: ViewSort; position?: number }

const MAX_PERSONAL = 50;
const MAX_SHARED = 100;

function requireUser(ctx: MemberContext): string {
  if (!ctx.userId) throw new AppError("forbidden", "Saved views belong to people; API tokens cannot use them");
  return ctx.userId;
}
const canEdit = (ctx: MemberContext, row: { ownerUserId: string }) => row.ownerUserId === ctx.userId || ctx.role === "admin";
const canShare = (ctx: MemberContext) => !!ctx.role && can(ctx.role, "issues:write");

/** The saved filters as a GET /v1/issues query (comma lists → arrays). */
function listQueryOf(base: SystemViewId, filters: ViewFilters) {
  const q = viewListQuery(base, filters);
  return {
    ...q,
    priority: q.priority ? (q.priority.split(",") as Priority[]) : undefined,
    channel: q.channel ? (q.channel.split(",") as ChannelKind[]) : undefined,
  };
}

async function audit(tx: Tx, ctx: MemberContext, action: string, id: string, metadata: Record<string, unknown>) {
  await tx.insert(schema.auditLog).values({ id: newId("auditLog"), workspaceId: ctx.workspaceId, actorType: ctx.actor.type, actorId: ctx.actor.id, action, targetType: "saved_view", targetId: id, metadata });
}
/** Shared views changed: tell other members' inboxes to refresh their view list (realtime, ids only). */
const announce = (tx: Tx, ctx: MemberContext, id: string) => tx.insert(schema.outbox).values({ workspaceId: ctx.workspaceId, type: "saved_view.changed", payload: { view_id: id } });

async function toDto(tx: Tx, ctx: MemberContext, row: typeof schema.savedViews.$inferSelect): Promise<SavedViewDto> {
  const [owner] = await tx.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, row.ownerUserId));
  return {
    id: row.id, name: row.name, shared: row.shared, base: row.base as SystemViewId, filters: row.filters as ViewFilters, sort: row.sort as ViewSort,
    position: row.position, owner_user_id: row.ownerUserId, owner_name: owner ? owner.name || owner.email : null,
    count: await countIssues(tx, ctx, listQueryOf(row.base as SystemViewId, row.filters as ViewFilters)),
    can_edit: canEdit(ctx, row), created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  };
}

/** Keep only known filter keys with non-empty values (the route has validated their content). */
const cleanFilters = (f: ViewFilters = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === "string" && v.trim() !== "").map(([k, v]) => [k, (v as string).trim()]));

export function createViewsService(db: Db) {
  async function load(tx: Tx, id: string) {
    const [row] = await tx.select().from(schema.savedViews).where(eq(schema.savedViews.id, id));
    if (!row) throw new AppError("not_found", "View not found");
    return row;
  }
  const duplicate = (name: string, shared: boolean) =>
    new AppError("conflict", shared ? `A shared view named "${name}" already exists` : `You already have a view named "${name}"`);

  return {
    /** Your personal views, then shared ones; each with its live count. */
    list: (ctx: MemberContext) => withWorkspace(db, ctx, async (tx) => {
      requireUser(ctx);
      const rows = await tx.select().from(schema.savedViews).orderBy(asc(schema.savedViews.shared), asc(schema.savedViews.position), asc(sql`lower(${schema.savedViews.name})`), asc(schema.savedViews.id));
      return { data: await Promise.all(rows.map((r) => toDto(tx, ctx, r))) };
    }),

    get: (ctx: MemberContext, id: string) => withWorkspace(db, ctx, async (tx) => { requireUser(ctx); return toDto(tx, ctx, await load(tx, id)); }),

    create: (ctx: MemberContext, input: ViewInput & { name: string; base: SystemViewId }) => withWorkspace(db, ctx, async (tx) => {
      const userId = requireUser(ctx);
      const shared = input.shared ?? false;
      if (shared && !canShare(ctx)) throw new AppError("forbidden", "Your role cannot share views with the workspace");
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.savedViews)
        .where(shared ? eq(schema.savedViews.shared, true) : and(eq(schema.savedViews.shared, false), eq(schema.savedViews.ownerUserId, userId)));
      if ((n?.n ?? 0) >= (shared ? MAX_SHARED : MAX_PERSONAL)) throw new AppError("validation_failed", `At most ${shared ? MAX_SHARED : MAX_PERSONAL} ${shared ? "shared" : "personal"} views`);
      const id = newId("savedView");
      const [row] = await tx.insert(schema.savedViews).values({
        id, workspaceId: ctx.workspaceId, ownerUserId: userId, shared, name: input.name, base: input.base,
        filters: cleanFilters(input.filters), sort: input.sort ?? "updated", position: input.position ?? 0,
      }).onConflictDoNothing().returning();
      if (!row) throw duplicate(input.name, shared);
      if (shared) { await audit(tx, ctx, "saved_view.created", id, { name: input.name }); await announce(tx, ctx, id); }
      return toDto(tx, ctx, row);
    }),

    update: (ctx: MemberContext, id: string, input: ViewInput) => withWorkspace(db, ctx, async (tx) => {
      requireUser(ctx);
      const row = await load(tx, id);
      if (!canEdit(ctx, row)) throw new AppError("forbidden", "Only the view's owner or an admin can change it");
      const sharing = input.shared !== undefined && input.shared !== row.shared;
      if (sharing && input.shared && !canShare(ctx)) throw new AppError("forbidden", "Your role cannot share views with the workspace");
      const set: Partial<typeof schema.savedViews.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) set.name = input.name;
      if (input.shared !== undefined) set.shared = input.shared;
      if (input.base !== undefined) set.base = input.base;
      if (input.filters !== undefined) set.filters = cleanFilters(input.filters);
      if (input.sort !== undefined) set.sort = input.sort;
      if (input.position !== undefined) set.position = input.position;
      let updated: (typeof schema.savedViews.$inferSelect)[];
      try {
        updated = await tx.transaction((sp) => sp.update(schema.savedViews).set(set).where(eq(schema.savedViews.id, id)).returning());
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicate(input.name ?? row.name, input.shared ?? row.shared);
        throw err;
      }
      if (row.shared || input.shared) {
        await audit(tx, ctx, "saved_view.updated", id, { fields: Object.keys(input), ...(sharing ? { shared: input.shared } : {}) });
        await announce(tx, ctx, id);
      }
      return toDto(tx, ctx, updated[0]!);
    }),

    remove: (ctx: MemberContext, id: string) => withWorkspace(db, ctx, async (tx) => {
      requireUser(ctx);
      const row = await load(tx, id);
      if (!canEdit(ctx, row)) throw new AppError("forbidden", "Only the view's owner or an admin can delete it");
      await tx.delete(schema.savedViews).where(eq(schema.savedViews.id, id));
      if (row.shared) { await audit(tx, ctx, "saved_view.deleted", id, { name: row.name }); await announce(tx, ctx, id); }
    }),
  };
}

import { sql } from "drizzle-orm";
import { isId } from "@tickzy/shared";
import type { Db, Tx } from "./client.ts";

export interface TenantContext {
  workspaceId: string;
  userId?: string | undefined;
}

/**
 * Runs `fn` in a transaction scoped to one tenant (ADR-005). `set_config(..., true)` is transaction-local,
 * so the setting can never leak to another request through a pooled connection.
 * Every tenant-table query MUST go through this helper; RLS denies everything otherwise.
 */
export async function withWorkspace<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isId(ctx.workspaceId, "workspace")) throw new Error(`invalid workspace id: ${ctx.workspaceId}`);
  if (ctx.userId !== undefined && !isId(ctx.userId, "user")) throw new Error(`invalid user id: ${ctx.userId}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspaceId}, true)`);
    if (ctx.userId) await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId}, true)`);
    return fn(tx);
  });
}

/** User-scoped (no tenant) transaction, e.g. listing the caller's own memberships is NOT possible here by design. */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isId(userId, "user")) throw new Error(`invalid user id: ${userId}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

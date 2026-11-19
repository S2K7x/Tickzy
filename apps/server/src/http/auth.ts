import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { AppError, isId } from "@tickzy/shared";
import { schema, withWorkspace, type Db, type Role } from "@tickzy/db";
import { can, type Permission } from "../permissions.ts";

export interface Principal {
  type: "user";
  userId: string;
}

export interface MemberContext {
  workspaceId: string;
  userId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

/**
 * Authentication. M0 ships only the development shim (`Authorization: Bearer dev_<userId>`), enabled solely
 * when AUTH_DEV_MODE=true (refused in production by config). T-101 replaces it with Better Auth sessions
 * and T-103 adds API tokens — both will populate the same `request.principal`.
 */
export function registerAuth(app: FastifyInstance, opts: { devMode: boolean }): void {
  app.decorateRequest("principal", null);
  app.addHook("onRequest", async (req) => {
    req.principal = null;
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;
    const token = header.slice("Bearer ".length).trim();
    if (opts.devMode && token.startsWith("dev_")) {
      const userId = token.slice("dev_".length);
      if (isId(userId, "user")) req.principal = { type: "user", userId };
    }
  });
}

export function requireUser(req: FastifyRequest): Principal {
  if (!req.principal) throw new AppError("unauthenticated", "Authentication required");
  return req.principal;
}

/**
 * Resolves the workspace from the `Tickzy-Workspace` header and verifies the caller's active membership
 * and permission. Non-members get 404 (not 403) so workspace existence is not disclosed.
 */
export async function requireMember(db: Db, req: FastifyRequest, permission?: Permission): Promise<MemberContext> {
  const principal = requireUser(req);
  const workspaceId = req.headers["tickzy-workspace"];
  if (typeof workspaceId !== "string" || !isId(workspaceId, "workspace")) {
    throw new AppError("validation_failed", "Missing or invalid Tickzy-Workspace header", [
      { path: "headers.tickzy-workspace", issue: "required" },
    ]);
  }
  const membership = await withWorkspace(db, { workspaceId, userId: principal.userId }, async (tx) => {
    const rows = await tx
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, principal.userId), eq(schema.memberships.status, "active")))
      .limit(1);
    return rows[0];
  });
  if (!membership) throw new AppError("not_found", "Workspace not found");
  if (permission && !can(membership.role, permission)) {
    throw new AppError("forbidden", `Missing permission ${permission}`);
  }
  return { workspaceId, userId: principal.userId, role: membership.role };
}

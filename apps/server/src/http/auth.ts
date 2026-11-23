import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { AppError, isId } from "@tickzy/shared";
import { schema, withWorkspace, type Db, type Role } from "@tickzy/db";
import { can, type Permission } from "../permissions.ts";
import type { AuthService } from "../modules/auth/service.ts";

export interface Principal {
  type: "user";
  userId: string;
  /** Present when authenticated by session cookie (absent for dev/bearer auth). */
  sessionId?: string;
}

export const SESSION_COOKIE = "tz_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

export interface AuthOptions {
  devMode: boolean;
  sessions: Pick<AuthService, "validateSession">;
  cookieSecure: boolean;
  allowedOrigins: string[];
}

export function sessionCookieOptions(secure: boolean, expires: Date) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", expires };
}

/**
 * Authentication (ADR-021). Resolves `request.principal` from, in order:
 *  1. the development shim `Authorization: Bearer dev_<userId>` (AUTH_DEV_MODE only; refused in production);
 *  2. the `tz_session` cookie (sliding renewal re-issues the cookie).
 * API tokens (T-103) will populate the same principal.
 *
 * CSRF (SEC-2): a mutating request whose Origin is present but not allow-listed is rejected, and a
 * cookie-authenticated mutating request must carry an allow-listed Origin. SameSite=Lax is a second layer.
 */
export function registerAuth(app: FastifyInstance, opts: AuthOptions): void {
  const allowed = new Set(opts.allowedOrigins);
  app.decorateRequest("principal", null);
  app.addHook("onRequest", async (req, reply) => {
    req.principal = null;
    const origin = req.headers.origin;
    const mutating = !SAFE_METHODS.has(req.method);
    if (mutating && origin !== undefined && !allowed.has(origin)) {
      throw new AppError("forbidden", "Cross-origin request rejected");
    }

    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      const token = header.slice("Bearer ".length).trim();
      if (opts.devMode && token.startsWith("dev_")) {
        const userId = token.slice("dev_".length);
        if (isId(userId, "user")) req.principal = { type: "user", userId };
      }
      return; // bearer requests never fall back to cookies
    }

    const cookie = req.cookies[SESSION_COOKIE];
    if (!cookie) return;
    const session = await opts.sessions.validateSession(cookie);
    if (!session) {
      void reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return;
    }
    if (mutating && (origin === undefined || !allowed.has(origin))) {
      throw new AppError("forbidden", "Missing or invalid Origin for a cookie-authenticated request");
    }
    req.principal = { type: "user", userId: session.userId, sessionId: session.sessionId };
    if (session.renewed) void reply.setCookie(SESSION_COOKIE, cookie, sessionCookieOptions(opts.cookieSecure, session.expiresAt));
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

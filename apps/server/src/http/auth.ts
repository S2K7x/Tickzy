import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { AppError, isId } from "@tickzy/shared";
import { schema, withWorkspace, type Db, type Role } from "@tickzy/db";
import { z } from "zod";
import { can, type Permission } from "../permissions.ts";
import type { AuthService } from "../modules/auth/service.ts";

export interface UserPrincipal {
  type: "user";
  userId: string;
  /** Present when authenticated by session cookie (absent for dev/bearer auth). */
  sessionId?: string;
}
/** A workspace-owned API token (T-103, ADR-022): bound to one workspace, limited to its scopes. */
export interface TokenPrincipal {
  type: "api_token";
  tokenId: string;
  workspaceId: string;
  scopes: ReadonlySet<string>;
}
export type Principal = UserPrincipal | TokenPrincipal;

export const SESSION_COOKIE = "tz_session";
export const API_TOKEN_PREFIX = "tkz_live_";

/** OpenAPI description of the workspace header: required for user sessions, implied by API tokens (requireMember enforces). */
export const WorkspaceHeader = z
  .object({ "tickzy-workspace": z.string().optional().describe("Workspace id (ws_…). Required with a session; API tokens imply their workspace.") })
  .passthrough();
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface Actor {
  type: "user" | "api_token";
  id: string;
}
export interface MemberContext {
  workspaceId: string;
  /** Absent for API-token requests. */
  userId?: string | undefined;
  /** Absent for API-token requests (their access is their scopes). */
  role: Role | null;
  actor: Actor;
}

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export interface AuthOptions {
  devMode: boolean;
  sessions: Pick<AuthService, "validateSession">;
  apiTokens: { authenticate(raw: string): Promise<TokenPrincipal | null> };
  cookieSecure: boolean;
  allowedOrigins: string[];
}

export function sessionCookieOptions(secure: boolean, expires: Date) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", expires };
}

/**
 * Authentication (ADR-021). Resolves `request.principal` from, in order:
 *  1. the development shim `Authorization: Bearer dev_<userId>` (AUTH_DEV_MODE only; refused in production);
 *  2. an API token `Authorization: Bearer tkz_live_…` (T-103; an invalid token is 401, never anonymous);
 *  3. the `tz_session` cookie (sliding renewal re-issues the cookie).
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
      } else if (token.startsWith(API_TOKEN_PREFIX)) {
        req.principal = await opts.apiTokens.authenticate(token);
        if (!req.principal) throw new AppError("unauthenticated", "Invalid, revoked or expired API token");
      }
      return; // bearer requests never fall back to cookies (and are not subject to cookie CSRF rules)
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

/** Endpoints about a person (their workspaces, sessions, accepting invites) are not available to API tokens. */
export function requireUser(req: FastifyRequest): UserPrincipal {
  if (!req.principal) throw new AppError("unauthenticated", "Authentication required");
  if (req.principal.type !== "user") throw new AppError("forbidden", "This endpoint requires a signed-in user, not an API token");
  return req.principal;
}

/**
 * Resolves the workspace from the `Tickzy-Workspace` header and verifies the caller's active membership
 * and permission. Non-members get 404 (not 403) so workspace existence is not disclosed.
 */
export async function requireMember(db: Db, req: FastifyRequest, permission?: Permission): Promise<MemberContext> {
  if (!req.principal) throw new AppError("unauthenticated", "Authentication required");
  const header = req.headers["tickzy-workspace"];
  if (req.principal.type === "api_token") {
    const token = req.principal;
    // The token decides the workspace; a conflicting header must not reveal or reach another workspace.
    if (header !== undefined && header !== token.workspaceId) throw new AppError("not_found", "Workspace not found");
    if (permission && !token.scopes.has(permission)) throw new AppError("forbidden", `API token lacks scope ${permission}`);
    return { workspaceId: token.workspaceId, role: null, actor: { type: "api_token", id: token.tokenId } };
  }
  const principal = req.principal;
  const workspaceId = header;
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
  return { workspaceId, userId: principal.userId, role: membership.role, actor: { type: "user", id: principal.userId } };
}

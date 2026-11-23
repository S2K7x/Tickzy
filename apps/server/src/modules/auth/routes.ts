import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withUser, type Db } from "@tickzy/db";
import { requireUser, SESSION_COOKIE, sessionCookieOptions } from "../../http/auth.ts";
import type { AuthService } from "./service.ts";

const User = z.object({ id: z.string(), email: z.string(), name: z.string() });
const Membership = z.object({ workspace_id: z.string(), name: z.string(), slug: z.string(), role: z.string() });

export function authRoutes(db: Db, auth: AuthService, opts: { cookieSecure: boolean }) {
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.post("/v1/auth/magic-link", {
      schema: {
        tags: ["auth"],
        summary: "Email a single-use sign-in link (same response whether or not the account exists)",
        security: [],
        body: z.object({ email: z.email().max(254) }),
        response: { 202: z.object({ status: z.literal("sent") }) },
      },
    }, async (req, reply) => {
      await auth.requestMagicLink(req.body.email, req.ip ?? null);
      return reply.code(202).send({ status: "sent" as const });
    });

    r.post("/v1/auth/magic-link/verify", {
      schema: {
        tags: ["auth"],
        summary: "Exchange a sign-in link token for a session cookie",
        security: [],
        body: z.object({ token: z.string().max(200) }),
        response: { 200: z.object({ user_id: z.string() }) },
      },
    }, async (req, reply) => {
      const s = await auth.verifyMagicLink(req.body.token, { userAgent: req.headers["user-agent"] ?? null, ip: req.ip ?? null });
      void reply.setCookie(SESSION_COOKIE, s.sessionToken, sessionCookieOptions(opts.cookieSecure, s.expiresAt));
      return { user_id: s.userId };
    });

    r.get("/v1/auth/session", {
      schema: {
        tags: ["auth"],
        summary: "The signed-in user and their workspaces",
        response: { 200: z.object({ user: User, workspaces: z.array(Membership) }) },
      },
    }, async (req) => {
      const principal = requireUser(req);
      return withUser(db, principal.userId, async (tx) => {
        const [u] = await tx.select().from(schema.users).limit(1);
        const ms = await tx.execute(sql`SELECT * FROM my_memberships()`);
        return {
          user: { id: u!.id, email: u!.email, name: u!.name },
          workspaces: ms.rows.map((m) => ({ workspace_id: String(m.workspace_id), name: String(m.workspace_name), slug: String(m.workspace_slug), role: String(m.role) })),
        };
      });
    });

    r.post("/v1/auth/sign-out", {
      schema: { tags: ["auth"], summary: "End the current session", response: { 204: z.null() } },
    }, async (req, reply) => {
      const principal = requireUser(req);
      if (principal.sessionId) await auth.signOut(principal.sessionId);
      void reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.code(204).send(null);
    });

    r.post("/v1/auth/sign-out-everywhere", {
      schema: { tags: ["auth"], summary: "End all of the caller's sessions", response: { 200: z.object({ revoked: z.number() }) } },
    }, async (req, reply) => {
      const principal = requireUser(req);
      const revoked = await auth.signOutEverywhere(principal.userId);
      void reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { revoked };
    });
  };
}

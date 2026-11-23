import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AppError } from "@tickzy/shared";
import { SESSION_COOKIE, sessionCookieOptions } from "../../http/auth.ts";
import type { AuthService } from "./service.ts";
import { PENDING_LOGIN_TTL_MS, type Oidc, type PendingLogin } from "./oidc.ts";

const Provider = z.enum(["google", "microsoft"]);

/** Parses the pending-login cookie; anything malformed counts as absent (the callback then fails closed). */
function readPending(raw: string | undefined): PendingLogin | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as PendingLogin;
  } catch {
    return null;
  }
}

export function oauthRoutes(oidc: Oidc, auth: AuthService, opts: { cookieSecure: boolean; publicOrigin: string }) {
  // `__Host-` (Secure, Path=/, no Domain) means no subdomain can plant a pending-login cookie (login CSRF).
  const PENDING_COOKIE = opts.cookieSecure ? "__Host-tz_oauth" : "tz_oauth";
  const pendingCookieOptions = { httpOnly: true, secure: opts.cookieSecure, sameSite: "lax" as const, path: "/" };

  const fail = (reply: FastifyReply, code: string) => {
    void reply.clearCookie(PENDING_COOKIE, { path: "/" });
    return reply.redirect(`${opts.publicOrigin}/sign-in?error=${encodeURIComponent(code)}`, 302);
  };

  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.get("/v1/auth/providers", {
      schema: { tags: ["auth"], summary: "Sign-in methods enabled on this deployment", security: [], response: { 200: z.object({ providers: z.array(Provider) }) } },
    }, async () => ({ providers: oidc.enabled() }));

    r.get("/v1/auth/oauth/:provider/start", {
      schema: {
        tags: ["auth"], summary: "Start Google/Microsoft sign-in (redirects to the provider)", security: [],
        params: z.object({ provider: Provider }), querystring: z.object({ return_to: z.string().max(200).optional() }),
      },
    }, async (req, reply) => {
      if (!oidc.enabled().includes(req.params.provider)) return fail(reply, "provider_disabled");
      try {
        const { url, pending } = await oidc.start(req.params.provider, req.query.return_to ?? "/");
        const value = Buffer.from(JSON.stringify(pending)).toString("base64url");
        void reply.setCookie(PENDING_COOKIE, value, { ...pendingCookieOptions, maxAge: PENDING_LOGIN_TTL_MS / 1000 });
        return reply.redirect(url.href, 302);
      } catch (err) {
        req.log.error({ err, provider: req.params.provider }, "oidc start failed");
        return fail(reply, "provider_unavailable");
      }
    });

    r.get("/v1/auth/oauth/:provider/callback", {
      schema: { tags: ["auth"], summary: "Provider redirect target; opens a session and returns to the app", security: [], params: z.object({ provider: Provider }) },
    }, async (req, reply) => {
      const query = req.query as Record<string, unknown>;
      if (typeof query.error === "string") return fail(reply, query.error === "access_denied" ? "cancelled" : "oauth_failed");
      const pending = readPending(req.cookies[PENDING_COOKIE]);
      try {
        const userId = await oidc.finish(req.params.provider, new URL(req.url, "http://callback.invalid"), pending);
        const session = await auth.createSession(userId, { userAgent: req.headers["user-agent"] ?? null, ip: req.ip ?? null });
        void reply.clearCookie(PENDING_COOKIE, { path: "/" });
        void reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(opts.cookieSecure, session.expiresAt));
        return reply.redirect(`${opts.publicOrigin}${pending!.returnTo}`, 302);
      } catch (err) {
        if (err instanceof AppError && err.message === "email_unverified") return fail(reply, "email_unverified");
        req.log.warn({ err: err instanceof Error ? err.message : String(err), provider: req.params.provider }, "oidc callback rejected");
        return fail(reply, "oauth_failed");
      }
    });
  };
}

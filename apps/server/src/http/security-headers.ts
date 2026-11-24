import type { FastifyInstance } from "fastify";

/**
 * Security headers on every API response (T-110, threat model TM-4). The API returns JSON, never documents to render,
 * so the policy forbids everything; responses are never cached (they are per-user and may contain customer data).
 * HSTS only when the deployment is served over https (Secure cookies), so local http development keeps working.
 */
export function registerSecurityHeaders(app: FastifyInstance, opts: { https: boolean }): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    void reply.header("X-Content-Type-Options", "nosniff");
    void reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    void reply.header("X-Frame-Options", "DENY");
    void reply.header("Referrer-Policy", "no-referrer");
    void reply.header("Cross-Origin-Resource-Policy", "same-origin");
    if (!reply.hasHeader("Cache-Control")) void reply.header("Cache-Control", "no-store");
    if (opts.https) void reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    return payload;
  });
}

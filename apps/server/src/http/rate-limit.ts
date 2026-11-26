import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@tickzy/shared";

/**
 * Rate limiting (T-106, SEC-9, ADR-023). Fixed one-minute windows, three layers:
 *  - `ip`        every request, keyed by client IP, before authentication (floods, token guessing);
 *  - `auth`      sensitive unauthenticated endpoints (sign-in links, invitation lookups), keyed by IP;
 *  - `principal` authenticated requests, keyed by API token or user (api-spec: 600/min per token).
 * Responses carry `RateLimit-Limit/Remaining/Reset` for the most specific layer; 429 adds `Retry-After`.
 * The store is in-memory per process (limits are per node); `RateLimitStore` is the seam for a shared store.
 */
export interface RateLimits {
  perPrincipal: number;
  perIp: number;
  authPerIp: number;
}

export interface RateLimitStore {
  /** Counts one hit; returns the count in the current window and when the window resets (epoch ms). */
  hit(key: string, windowMs: number, now: number): { count: number; resetAt: number };
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private nextSweep = 0;
  hit(key: string, windowMs: number, now: number) {
    if (now >= this.nextSweep) {
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
      this.nextSweep = now + windowMs;
    }
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return { count: w.count, resetAt: w.resetAt };
  }
  get size(): number {
    return this.windows.size;
  }
}

const WINDOW_MS = 60_000;
const EXEMPT = new Set(["/healthz", "/readyz"]);
/** Unauthenticated endpoints that send email or look up secrets get a tight per-IP budget. */
const AUTH_ROUTES = new Set([
  "POST /v1/auth/magic-link",
  "POST /v1/auth/magic-link/verify",
  "POST /v1/invitations/preview",
  "POST /v1/invitations/accept",
  "GET /v1/auth/oauth/google/start",
  "GET /v1/auth/oauth/google/callback",
  "GET /v1/auth/oauth/microsoft/start",
  "GET /v1/auth/oauth/microsoft/callback",
]);

export function apply(reply: FastifyReply, limit: number, count: number, resetAt: number, now: number, message: string) {
  const resetSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  void reply.header("ratelimit-limit", String(limit));
  void reply.header("ratelimit-remaining", String(Math.max(0, limit - count)));
  void reply.header("ratelimit-reset", String(resetSeconds));
  if (count > limit) {
    void reply.header("retry-after", String(resetSeconds));
    throw new AppError("rate_limited", message);
  }
}

/** Registers the pre-authentication layers. Call before `registerAuth`. */
export function registerRateLimitBeforeAuth(app: FastifyInstance, limits: RateLimits, store: RateLimitStore, now: () => number = Date.now) {
  app.addHook("onRequest", async (req: FastifyRequest, reply) => {
    const path = req.url.split("?")[0]!;
    if (EXEMPT.has(path)) return;
    const t = now();
    const ip = store.hit(`ip:${req.ip}`, WINDOW_MS, t);
    apply(reply, limits.perIp, ip.count, ip.resetAt, t, "Too many requests from this network. Slow down and retry later.");
    if (AUTH_ROUTES.has(`${req.method} ${path}`)) {
      const a = store.hit(`auth:${req.ip}`, WINDOW_MS, t);
      apply(reply, limits.authPerIp, a.count, a.resetAt, t, "Too many attempts. Wait a minute and try again.");
    }
  });
}

/** Registers the per-principal layer. Call after `registerAuth` (needs `request.principal`). */
export function registerRateLimitAfterAuth(app: FastifyInstance, limits: RateLimits, store: RateLimitStore, now: () => number = Date.now) {
  app.addHook("onRequest", async (req, reply) => {
    const p = req.principal;
    if (!p) return;
    const t = now();
    const key = p.type === "api_token" ? `tok:${p.tokenId}` : `usr:${p.userId}`;
    const r = store.hit(key, WINDOW_MS, t);
    apply(reply, limits.perPrincipal, r.count, r.resetAt, t, p.type === "api_token" ? "API token rate limit exceeded." : "Too many requests. Slow down and retry later.");
  });
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { trustProxySetting } from "../config.ts";
import { auth, setupTestApp, testConfig } from "../test-helpers.ts";
import { MemoryRateLimitStore } from "./rate-limit.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string;
let bob: string;
let ws: string;
let clock = 1_800_000_000_000;
const now = () => clock;

async function appWith(limits: { per?: number; ip?: number; auth?: number; trustProxy?: string }): Promise<FastifyInstance> {
  return buildApp({
    config: {
      ...testConfig,
      RATE_LIMIT_PER_MIN: limits.per ?? 1000, RATE_LIMIT_IP_PER_MIN: limits.ip ?? 1000, RATE_LIMIT_AUTH_PER_MIN: limits.auth ?? 1000,
      TRUST_PROXY: limits.trustProxy ?? "false",
    },
    database: t.database, email: t.email, now,
  });
}

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
  ws = (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: "Acme", slug: "acme", issue_prefix: "ACME" } })).json().id;
});
afterAll(async () => { await t.teardown(); });

describe("rate limiting (T-106, SEC-9)", () => {
  it("adds RateLimit headers to normal responses", async () => {
    const app = await appWith({ per: 5 });
    const res = await app.inject({ url: "/v1/workspaces/current", headers: auth(alice, ws) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBe("5");
    expect(res.headers["ratelimit-remaining"]).toBe("4");
    expect(Number(res.headers["ratelimit-reset"])).toBeGreaterThan(0);
    await app.close();
  });

  it("limits each API token separately, answers 429 with Retry-After and the error envelope, and resets after the window", async () => {
    const app = await appWith({ per: 3 });
    const mk = async (name: string) => (await app.inject({ method: "POST", url: "/v1/api-tokens", headers: auth(alice, ws), payload: { name, scopes: ["workspace:manage"], expires_in_days: null } })).json().token as string;
    // Token creation above was 2 user requests; tokens have their own buckets.
    const [a, b] = [await mk("a"), await mk("b")];
    const get = (tok: string) => app.inject({ url: "/v1/workspaces/current", headers: { authorization: `Bearer ${tok}` } });
    for (let i = 0; i < 3; i++) expect((await get(a)).statusCode).toBe(200);
    const limited = await get(a);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("rate_limited");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers["ratelimit-remaining"]).toBe("0");
    expect((await get(b)).statusCode).toBe(200);
    clock += 60_000;
    expect((await get(a)).statusCode).toBe(200);
    await app.close();
  });

  it("limits each signed-in user separately", async () => {
    const app = await appWith({ per: 2 });
    for (let i = 0; i < 2; i++) expect((await app.inject({ url: "/v1/me/workspaces", headers: auth(alice) })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/me/workspaces", headers: auth(alice) })).statusCode).toBe(429);
    expect((await app.inject({ url: "/v1/me/workspaces", headers: auth(bob) })).statusCode).toBe(200);
    clock += 60_000;
    await app.close();
  });

  it("gives sign-in and invitation endpoints a tight per-IP budget regardless of the email", async () => {
    const app = await appWith({ auth: 2 });
    const send = (email: string, ip = "203.0.113.7") =>
      app.inject({ method: "POST", url: "/v1/auth/magic-link", payload: { email }, remoteAddress: ip });
    expect((await send("one@example.com")).statusCode).toBe(202);
    expect((await send("two@example.com")).statusCode).toBe(202);
    const third = await send("three@example.com");
    expect(third.statusCode).toBe(429);
    expect(third.json().error.message).toBe("Too many attempts. Wait a minute and try again.");
    expect((await send("four@example.com", "203.0.113.8")).statusCode).toBe(202); // another client
    const preview = await app.inject({ method: "POST", url: "/v1/invitations/preview", payload: { token: "x".repeat(20) }, remoteAddress: "203.0.113.7" });
    expect(preview.statusCode).toBe(429);
    clock += 60_000;
    await app.close();
  });

  it("limits per IP before authentication, so guessing tokens is throttled", async () => {
    const app = await appWith({ ip: 3 });
    const guess = () => app.inject({ url: "/v1/workspaces/current", headers: { authorization: `Bearer tkz_live_${"a".repeat(24)}.${"b".repeat(52)}` }, remoteAddress: "198.51.100.1" });
    for (let i = 0; i < 3; i++) expect((await guess()).statusCode).toBe(401);
    expect((await guess()).statusCode).toBe(429);
    clock += 60_000;
    await app.close();
  });

  it("never limits health checks", async () => {
    const app = await appWith({ ip: 1 });
    for (let i = 0; i < 5; i++) expect((await app.inject({ url: "/healthz", remoteAddress: "198.51.100.2" })).statusCode).toBe(200);
    clock += 60_000;
    await app.close();
  });

  it("ignores X-Forwarded-For by default (clients cannot pick their IP), honours it behind a configured proxy", async () => {
    const spoofed = await appWith({ ip: 2 });
    for (const xff of ["1.1.1.1", "2.2.2.2"]) {
      expect((await spoofed.inject({ url: "/v1/auth/session", headers: { "x-forwarded-for": xff }, remoteAddress: "192.0.2.1" })).statusCode).toBe(401);
    }
    expect((await spoofed.inject({ url: "/v1/auth/session", headers: { "x-forwarded-for": "3.3.3.3" }, remoteAddress: "192.0.2.1" })).statusCode).toBe(429);
    await spoofed.close();

    const proxied = await appWith({ ip: 2, trustProxy: "1" });
    for (const xff of ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]) {
      expect((await proxied.inject({ url: "/v1/auth/session", headers: { "x-forwarded-for": xff }, remoteAddress: "192.0.2.1" })).statusCode).toBe(401);
    }
    clock += 60_000;
    await proxied.close();
  });
});

describe("rate limit building blocks", () => {
  it("parses TRUST_PROXY safely", () => {
    expect(trustProxySetting("false")).toBe(false);
    expect(trustProxySetting("")).toBe(false);
    expect(trustProxySetting("10.0.0.0/8, 127.0.0.1")).toEqual(["10.0.0.0/8", "127.0.0.1"]);
    const fn = trustProxySetting("1") as (a: string, h: number) => boolean;
    expect([fn("x", 0), fn("x", 1)]).toEqual([true, false]);
    expect(() => trustProxySetting("true")).toThrow(/spoofed/);
  });

  it("the memory store forgets expired windows (bounded memory)", () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < 100; i++) store.hit(`k${i}`, 60_000, 0);
    expect(store.size).toBe(100);
    store.hit("fresh", 60_000, 60_001);
    expect(store.size).toBe(1);
  });
});

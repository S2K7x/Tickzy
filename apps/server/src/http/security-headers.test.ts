import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, setupTestApp, testConfig } from "../test-helpers.ts";
import { buildApp } from "../app.ts";

/** T-110: every API response carries the security headers (threat model TM-4). */
let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string;
beforeAll(async () => { t = await setupTestApp(); alice = await t.createUser("alice@example.com"); });
afterAll(async () => { await t.teardown(); });

const expectHardened = (h: Record<string, unknown>) => {
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["cache-control"]).toBe("no-store");
};

describe("security headers (T-110)", () => {
  it("on success, error, 404 and unauthenticated responses", async () => {
    const ok = await t.app.inject({ url: "/v1/auth/session", headers: auth(alice) });
    expect(ok.statusCode).toBe(200);
    expectHardened(ok.headers);
    expectHardened((await t.app.inject({ url: "/v1/issues", headers: auth(alice, "ws_01JD0000000000000000000000") })).headers);
    expectHardened((await t.app.inject({ url: "/v1/nope" })).headers);
    expectHardened((await t.app.inject({ url: "/v1/auth/session" })).headers);
    expectHardened((await t.app.inject({ method: "POST", url: "/v1/auth/magic-link", payload: { email: "x" } })).headers);
  });

  it("HSTS only when served over https (Secure cookies); plain-http development gets none", async () => {
    expect(testConfig.COOKIE_SECURE).toBe(true);
    expect((await t.app.inject({ url: "/healthz" })).headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
    const plain = await buildApp({ config: { ...testConfig, COOKIE_SECURE: false }, database: t.database, email: t.email });
    try {
      const res = await plain.inject({ url: "/healthz" });
      expect(res.headers["strict-transport-security"]).toBeUndefined();
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    } finally { await plain.close(); }
  });
});

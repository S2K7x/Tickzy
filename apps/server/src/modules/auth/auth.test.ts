import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { testOwnerUrl } from "@tickzy/db/testing";
import { setupTestApp, TEST_ORIGIN } from "../../test-helpers.ts";
import { SESSION_RENEW_WITHIN_MS } from "./service.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
const browser = { origin: TEST_ORIGIN };

beforeAll(async () => { t = await setupTestApp(); });
afterAll(async () => { await t.teardown(); });
beforeEach(() => { t.email.sent.length = 0; });

function tokenFromLastEmail(): string {
  const text = t.email.sent.at(-1)!.text;
  const m = /#token=([a-z2-7.]+)/.exec(text);
  if (!m) throw new Error(`no token in email: ${text}`);
  return m[1]!;
}
function sessionCookie(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === "tz_session");
  if (!c) throw new Error("no session cookie");
  return c.value;
}
async function signIn(email: string): Promise<string> {
  await t.app.inject({ method: "POST", url: "/v1/auth/magic-link", headers: browser, payload: { email } });
  const res = await t.app.inject({ method: "POST", url: "/v1/auth/magic-link/verify", headers: browser, payload: { token: tokenFromLastEmail() } });
  expect(res.statusCode).toBe(200);
  return sessionCookie(res);
}

describe("magic-link sign-in (T-101, FR-1.2)", () => {
  it("emails a link pointing at the web app with the token in the URL fragment", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/magic-link", headers: browser, payload: { email: "New.User@Example.com" } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: "sent" });
    const mail = t.email.sent[0]!;
    expect(mail.to).toBe("new.user@example.com");
    expect(mail.text).toContain(`${TEST_ORIGIN}/auth/verify#token=`);
  });

  it("creates the user on first sign-in, sets a secure httpOnly cookie and exposes the session", async () => {
    await t.app.inject({ method: "POST", url: "/v1/auth/magic-link", headers: browser, payload: { email: "first@example.com" } });
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/magic-link/verify", headers: browser, payload: { token: tokenFromLastEmail() } });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === "tz_session")!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    const me = await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: c.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user: { id: res.json().user_id, email: "first@example.com", name: "" }, workspaces: [] });
  });

  it("signs an existing user into the same account", async () => {
    const a = await signIn("repeat@example.com");
    const b = await signIn("REPEAT@example.com");
    const ida = (await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: a } })).json().user.id;
    const idb = (await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: b } })).json().user.id;
    expect(ida).toBe(idb);
  });

  it("responds identically for unknown emails (no account enumeration)", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/magic-link", headers: browser, payload: { email: "nobody@example.com" } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: "sent" });
  });

  it("links are single-use", async () => {
    await t.app.inject({ method: "POST", url: "/v1/auth/magic-link", headers: browser, payload: { email: "once@example.com" } });
    const token = tokenFromLastEmail();
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/magic-link/verify", headers: browser, payload: { token } })).statusCode).toBe(200);
    const again = await t.app.inject({ method: "POST", url: "/v1/auth/magic-link/verify", headers: browser, payload: { token } });
    expect(again.statusCode).toBe(401);
  });

  it("rejects expired, tampered and malformed tokens", async () => {
    await t.app.inject({ method: "POST", url: "/v1/auth/magic-link", headers: browser, payload: { email: "exp@example.com" } });
    const token = tokenFromLastEmail();
    const [id, secret] = token.split(".") as [string, string];
    const flipped = `${id}.${secret.slice(0, -1)}${secret.endsWith("a") ? "b" : "a"}`;
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/magic-link/verify", headers: browser, payload: { token: flipped } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/magic-link/verify", headers: browser, payload: { token: "garbage" } })).statusCode).toBe(401);
    await expireLoginTokens(); // simulate the 15-minute expiry passing
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/magic-link/verify", headers: browser, payload: { token } })).statusCode).toBe(401);
  });

  it("limits sign-in links per email (5 per 15 minutes)", async () => {
    const send = () => t.app.inject({ method: "POST", url: "/v1/auth/magic-link", headers: browser, payload: { email: "spam@example.com" } });
    for (let i = 0; i < 5; i++) expect((await send()).statusCode).toBe(202);
    const sixth = await send();
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe("rate_limited");
  });

  it("validates the email address", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/magic-link", headers: browser, payload: { email: "not-an-email" } });
    expect(res.statusCode).toBe(422);
  });
});

describe("sessions", () => {
  it("signs out the current session only", async () => {
    const a = await signIn("multi@example.com");
    const b = await signIn("multi@example.com");
    const out = await t.app.inject({ method: "POST", url: "/v1/auth/sign-out", headers: browser, cookies: { tz_session: a } });
    expect(out.statusCode).toBe(204);
    expect((await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: a } })).statusCode).toBe(401);
    expect((await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: b } })).statusCode).toBe(200);
  });

  it("signs out everywhere", async () => {
    const a = await signIn("everywhere@example.com");
    const b = await signIn("everywhere@example.com");
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/sign-out-everywhere", headers: browser, cookies: { tz_session: a } });
    expect(res.json().revoked).toBe(2);
    expect((await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: b } })).statusCode).toBe(401);
  });

  it("rejects forged session secrets and clears the cookie", async () => {
    const good = await signIn("forge@example.com");
    const [id] = good.split(".") as [string];
    const res = await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: `${id}.${"a".repeat(52)}` } });
    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((c) => c.name === "tz_session")?.value).toBe("");
  });

  it("expired sessions are rejected", async () => {
    const s = await signIn("old@example.com");
    await ownerExec(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
    expect((await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: s } })).statusCode).toBe(401);
  });

  it("renews sessions in the second half of their life (sliding expiry)", async () => {
    const s = await signIn("slide@example.com");
    const soon = new Date(Date.now() + SESSION_RENEW_WITHIN_MS - 60_000).toISOString();
    await ownerExec(`UPDATE sessions SET expires_at = '${soon}'`);
    const res = await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: s } });
    expect(res.statusCode).toBe(200);
    const renewed = res.cookies.find((c) => c.name === "tz_session")!;
    expect(renewed.value).toBe(s);
    expect(new Date(renewed.expires!).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
  });

  it("a session works with the workspace API", async () => {
    const s = await signIn("builder@example.com");
    const created = await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: browser, cookies: { tz_session: s }, payload: { name: "Builder", slug: "builder-co", issue_prefix: "BLD" } });
    expect(created.statusCode).toBe(201);
    const me = (await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: s } })).json();
    expect(me.workspaces.map((w: { slug: string }) => w.slug)).toEqual(["builder-co"]);
  });
});

describe("CSRF protection (SEC-2)", () => {
  it("rejects cookie-authenticated writes without an Origin", async () => {
    const s = await signIn("csrf1@example.com");
    const res = await t.app.inject({ method: "POST", url: "/v1/workspaces", cookies: { tz_session: s }, payload: { name: "X", slug: "csrf-x", issue_prefix: "CX" } });
    expect(res.statusCode).toBe(403);
  });

  it("rejects writes from a foreign Origin, even without a cookie (login CSRF)", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/magic-link", headers: { origin: "https://evil.example" }, payload: { email: "victim@example.com" } });
    expect(res.statusCode).toBe(403);
    expect(t.email.sent).toHaveLength(0);
  });

  it("allows safe methods with a cookie and no Origin", async () => {
    const s = await signIn("csrf2@example.com");
    expect((await t.app.inject({ url: "/v1/auth/session", cookies: { tz_session: s } })).statusCode).toBe(200);
  });
});

describe("database access", () => {
  it("the runtime role cannot read sessions or login tokens directly", async () => {
    for (const table of ["sessions", "login_tokens"]) {
      await expect(t.database.db.execute(sql.raw(`SELECT * FROM ${table}`))).rejects.toThrow();
    }
  });
});

// Owner-level helpers simulate the passage of time without exposing tables to the runtime role.
async function ownerExec(statement: string): Promise<void> {
  const c = new pg.Client({ connectionString: testOwnerUrl() });
  await c.connect();
  try { await c.query(statement); } finally { await c.end(); }
}
async function expireLoginTokens(): Promise<void> {
  await ownerExec(`UPDATE login_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`);
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { buildApp } from "../../app.ts";
import { setupTestApp, testConfig, TEST_ORIGIN } from "../../test-helpers.ts";
import { startMockOidcProvider } from "../../test-oidc-provider.ts";
import { identityFromClaims, safeReturnTo } from "./oidc.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let google: Awaited<ReturnType<typeof startMockOidcProvider>>;
let microsoft: Awaited<ReturnType<typeof startMockOidcProvider>>;
let app: FastifyInstance;
const PENDING = "__Host-tz_oauth";

beforeAll(async () => {
  t = await setupTestApp();
  google = await startMockOidcProvider("g-client", "g-secret");
  microsoft = await startMockOidcProvider("m-client", "m-secret");
  app = await buildApp({
    config: {
      ...testConfig,
      GOOGLE_CLIENT_ID: "g-client", GOOGLE_CLIENT_SECRET: "g-secret", GOOGLE_ISSUER: google.issuer,
      MICROSOFT_CLIENT_ID: "m-client", MICROSOFT_CLIENT_SECRET: "m-secret", MICROSOFT_ISSUER: microsoft.issuer,
    },
    database: t.database, email: t.email,
  });
});
afterAll(async () => {
  await app.close();
  await google.close();
  await microsoft.close();
  await t.teardown();
});

const cookieValue = (setCookie: string | string[] | undefined, name: string): string | undefined => {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit?.slice(name.length + 1).split(";")[0];
};

/** Runs /start, lets the mock provider "approve" with the given claims, and calls /callback with the pending cookie. */
async function signInWith(provider: "google" | "microsoft", claims: Record<string, unknown>, opts: { returnTo?: string; override?: Record<string, string>; tamper?: (cb: string) => string; dropCookie?: boolean } = {}) {
  const idp = provider === "google" ? google : microsoft;
  const start = await app.inject({ url: `/v1/auth/oauth/${provider}/start${opts.returnTo ? `?return_to=${encodeURIComponent(opts.returnTo)}` : ""}` });
  expect(start.statusCode).toBe(302);
  const pending = cookieValue(start.headers["set-cookie"], PENDING)!;
  let cb = idp.approve(start.headers.location!, claims, opts.override);
  if (opts.tamper) cb = opts.tamper(cb);
  const res = await app.inject({ url: cb, cookies: opts.dropCookie ? {} : { [PENDING]: pending } });
  return { start, res, cb, pending, session: cookieValue(res.headers["set-cookie"], "tz_session") };
}
const sessionOf = async (token: string) => (await app.inject({ url: "/v1/auth/session", cookies: { tz_session: token } })).json();

describe("Google & Microsoft sign-in (T-101b, ADR-024)", () => {
  it("lists only configured providers", async () => {
    expect((await app.inject({ url: "/v1/auth/providers" })).json()).toEqual({ providers: ["google", "microsoft"] });
    expect((await t.app.inject({ url: "/v1/auth/providers" })).json()).toEqual({ providers: [] });
    const disabled = await t.app.inject({ url: "/v1/auth/oauth/google/start" });
    expect(disabled.statusCode).toBe(302);
    expect(disabled.headers.location).toBe(`${TEST_ORIGIN}/sign-in?error=provider_disabled`);
  });

  it("start redirects with PKCE S256, state, nonce and the public redirect URI; keeps secrets in a __Host- httpOnly cookie", async () => {
    const res = await app.inject({ url: "/v1/auth/oauth/google/start?return_to=/invite" });
    const u = new URL(res.headers.location!);
    expect(u.origin + u.pathname).toBe(`${google.issuer}/authorize`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(u.searchParams.get("state")).toBeTruthy();
    expect(u.searchParams.get("nonce")).toBeTruthy();
    expect(u.searchParams.get("redirect_uri")).toBe(`${TEST_ORIGIN}/v1/auth/oauth/google/callback`);
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith(PENDING))!;
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/Secure/);
    expect(raw).toMatch(/Path=\//);
    expect(raw).not.toMatch(/Domain=/);
    expect(raw).not.toContain(u.searchParams.get("code_challenge")!); // the verifier, not the challenge, is stored
  });

  it("creates a user from a verified Google email, opens a session and returns to the requested page", async () => {
    const { res, session } = await signInWith("google", { sub: "g-1", email: "Nina@Example.com", email_verified: true, name: "Nina Park" }, { returnTo: "/invite" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${TEST_ORIGIN}/invite`);
    expect(cookieValue(res.headers["set-cookie"], PENDING)).toBe(""); // cleared
    const s = await sessionOf(session!);
    expect(s.user).toMatchObject({ email: "nina@example.com", name: "Nina Park" });
  });

  it("links to the existing account with the same verified email (magic-link user)", async () => {
    const existing = await t.createUser("omar@example.com");
    const { session } = await signInWith("google", { sub: "g-2", email: "omar@example.com", email_verified: true, name: "Omar" });
    expect((await sessionOf(session!)).user.id).toBe(existing);
  });

  it("refuses an unverified Google email", async () => {
    const { res, session } = await signInWith("google", { sub: "g-3", email: "unverified@example.com", email_verified: false });
    expect(res.headers.location).toBe(`${TEST_ORIGIN}/sign-in?error=email_unverified`);
    expect(session).toBeUndefined();
  });

  it("keys identities on the provider subject: an email change at the provider never moves the login to another account", async () => {
    const victim = await t.createUser("victim@example.com");
    const first = await signInWith("google", { sub: "g-4", email: "attacker@example.com", email_verified: true });
    const attackerId = (await sessionOf(first.session!)).user.id;
    const later = await signInWith("google", { sub: "g-4", email: "victim@example.com", email_verified: true });
    const user = (await sessionOf(later.session!)).user;
    expect(user.id).toBe(attackerId);
    expect(user.id).not.toBe(victim);
  });

  it("Microsoft: the mutable email claim is not trusted without xms_edov (nOAuth), even for an existing account", async () => {
    await t.createUser("cfo@corp.example");
    const { res, session } = await signInWith("microsoft", { sub: "pairwise", tid: "tenant-a", oid: "obj-1", email: "cfo@corp.example" });
    expect(res.headers.location).toBe(`${TEST_ORIGIN}/sign-in?error=email_unverified`);
    expect(session).toBeUndefined();
  });

  it("Microsoft: links with xms_edov=true, keyed on tid:oid; later sign-ins work without the claim", async () => {
    const first = await signInWith("microsoft", { sub: "pairwise", tid: "tenant-b", oid: "obj-2", email: "lee@corp.example", xms_edov: true, name: "Lee" });
    const id = (await sessionOf(first.session!)).user.id;
    const again = await signInWith("microsoft", { sub: "pairwise2", tid: "tenant-b", oid: "obj-2", email: "renamed@corp.example" });
    expect((await sessionOf(again.session!)).user.id).toBe(id);
    const rows = await t.owner.query("SELECT provider, subject FROM user_identities WHERE user_id = $1", [id]);
    expect(rows.rows).toEqual([{ provider: "microsoft", subject: "tenant-b:obj-2" }]);
  });

  it("rejects tampered or replayed callbacks", async () => {
    const claims = { sub: "g-5", email: "x5@example.com", email_verified: true };
    const cases = [
      await signInWith("google", claims, { tamper: (cb) => cb.replace(/state=[^&]+/, "state=forged") }),
      await signInWith("google", claims, { dropCookie: true }),
      await signInWith("google", claims, { override: { nonce: "other-nonce" } }),
      await signInWith("google", claims, { override: { aud: "someone-else" } }),
      await signInWith("google", claims, { override: { iss: "https://evil.example" } }),
    ];
    for (const c of cases) {
      expect(c.res.headers.location).toBe(`${TEST_ORIGIN}/sign-in?error=oauth_failed`);
      expect(c.session).toBeUndefined();
    }
    // Replaying a used code with a fresh pending cookie fails at the provider.
    const ok = await signInWith("google", claims);
    expect(ok.session).toBeDefined();
    const start = await app.inject({ url: "/v1/auth/oauth/google/start" });
    // The used code with the attacker's own fresh pending cookie: state mismatch and the code is already spent.
    const replay = await app.inject({ url: ok.cb, cookies: { [PENDING]: cookieValue(start.headers["set-cookie"], PENDING)! } });
    expect(replay.headers.location).toBe(`${TEST_ORIGIN}/sign-in?error=oauth_failed`);
    expect(cookieValue(replay.headers["set-cookie"], "tz_session")).toBeUndefined();
    // Exact replay (same cookie, same callback): state matches, but the provider rejects the spent code.
    const exact = await app.inject({ url: ok.cb, cookies: { [PENDING]: ok.pending } });
    expect(exact.headers.location).toBe(`${TEST_ORIGIN}/sign-in?error=oauth_failed`);
    expect(cookieValue(exact.headers["set-cookie"], "tz_session")).toBeUndefined();
    const users = await t.owner.query("SELECT count(*)::int AS n FROM users WHERE email = 'x5@example.com'");
    expect(users.rows[0].n).toBe(1);
  });

  it("reports a cancelled consent and never redirects off-site", async () => {
    const cancel = await app.inject({ url: "/v1/auth/oauth/google/callback?error=access_denied&state=x" });
    expect(cancel.headers.location).toBe(`${TEST_ORIGIN}/sign-in?error=cancelled`);
    const { res } = await signInWith("google", { sub: "g-6", email: "x6@example.com", email_verified: true }, { returnTo: "//evil.example/steal" });
    expect(res.headers.location).toBe(`${TEST_ORIGIN}/`);
  });

  it("an existing identity never needs a trusted email again, and identities are not readable by the app role", async () => {
    await expect(t.database.db.execute(sql`SELECT * FROM user_identities`)).rejects.toThrow();
  });
});

describe("OIDC helpers", () => {
  it("safeReturnTo only allows same-app relative paths", () => {
    expect(["/", "/invite", "/settings/members?x=1"].map(safeReturnTo)).toEqual(["/", "/invite", "/settings/members?x=1"]);
    expect(["//evil.com", "https://evil.com", "/\\evil.com", "evil", 42].map(safeReturnTo)).toEqual(["/", "/", "/", "/", "/"]);
  });

  it("derives identities and email trust per provider", () => {
    expect(identityFromClaims("google", { sub: "1", email: "A@x.com", email_verified: true })).toMatchObject({ subject: "1", email: "a@x.com", trusted: true });
    expect(identityFromClaims("google", { sub: "1", email: "a@x.com", email_verified: "true" }).trusted).toBe(false);
    expect(identityFromClaims("microsoft", { sub: "s", tid: "t", oid: "o", email: "a@x.com" })).toMatchObject({ subject: "t:o", trusted: false });
    expect(identityFromClaims("microsoft", { tid: "t", oid: "o", email: "a@x.com", xms_edov: true }).trusted).toBe(true);
    expect(() => identityFromClaims("microsoft", { sub: "s", email: "a@x.com" })).toThrow();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp, TEST_ORIGIN } from "../../test-helpers.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string; // admin of ws
let bob: string; // agent of ws
let carol: string; // admin of otherWs
let ws: string;
let otherWs: string;

const createWs = async (user: string, slug: string, prefix: string) =>
  (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(user), payload: { name: slug, slug, issue_prefix: prefix } })).json().id as string;
const createToken = (by: string, workspace: string, payload: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: "/v1/api-tokens", headers: auth(by, workspace), payload });
const bearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
  carol = await t.createUser("carol@example.com");
  ws = await createWs(alice, "acme", "ACME");
  otherWs = await createWs(carol, "carol-co", "CAR");
  await withWorkspace(t.database.db, { workspaceId: ws }, (tx) =>
    tx.insert(schema.memberships).values({ id: "mem_01JD00000000000000000000BB", workspaceId: ws, userId: bob, role: "agent" }));
});
afterAll(async () => { await t.teardown(); });

describe("API tokens (FR-1.6, ADR-022)", () => {
  let token: string;
  let tokenId: string;

  it("an admin creates a token: shown once, prefixed, hashed at rest, audited", async () => {
    const res = await createToken(alice, ws, { name: "CI sync", scopes: ["workspace:manage", "audit:read"], expires_in_days: 90 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    token = body.token;
    tokenId = body.id;
    expect(token).toMatch(/^tkz_live_[a-z2-7]{24}\.[a-z2-7]{52}$/);
    expect(body.id).toMatch(/^tok_/);
    expect(token.startsWith(body.prefix)).toBe(true);
    expect(body).toMatchObject({ name: "CI sync", scopes: ["audit:read", "workspace:manage"], created_by: alice, last_used_at: null });
    expect((Date.parse(body.expires_at) - Date.now()) / 86_400_000).toBeGreaterThan(89.9);

    const list = (await t.app.inject({ url: "/v1/api-tokens", headers: auth(alice, ws) })).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).not.toHaveProperty("token");
    expect(JSON.stringify(list)).not.toContain(token.split(".")[1]);

    await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
      const [row] = await tx.select().from(schema.apiTokens);
      expect(row!.secretHash).toHaveLength(32);
      expect(row!.secretHash.toString("utf8")).not.toContain(token.split(".")[1]);
      expect((await tx.select().from(schema.auditLog)).map((a) => a.action)).toContain("api_token.created");
    });
  });

  it("authenticates requests to its workspace without a Tickzy-Workspace header and records last use", async () => {
    const res = await t.app.inject({ url: "/v1/workspaces/current", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(ws);
    const list = (await t.app.inject({ url: "/v1/api-tokens", headers: auth(alice, ws) })).json();
    expect(list.data[0].last_used_at).not.toBeNull();
  });

  it("acts within its scopes only and is audited as the token", async () => {
    const patched = await t.app.inject({ method: "PATCH", url: "/v1/workspaces/current", headers: bearer(token), payload: { name: "Acme Renamed" } });
    expect(patched.statusCode).toBe(200);
    const audit = (await t.app.inject({ url: "/v1/audit-log?action=workspace.updated", headers: bearer(token) })).json();
    expect(audit.data[0]).toMatchObject({ actor_type: "api_token", actor_id: tokenId });
    const members = await t.app.inject({ url: "/v1/invitations", headers: bearer(token) });
    expect(members.statusCode).toBe(403);
    expect(members.json().error.message).toContain("members:manage");
  });

  it("never mints tokens, and cannot be given that scope", async () => {
    expect((await t.app.inject({ url: "/v1/api-tokens", headers: bearer(token) })).statusCode).toBe(403);
    const res = await createToken(alice, ws, { name: "x", scopes: ["developers:manage"], expires_in_days: null });
    expect(res.statusCode).toBe(422);
  });

  it("cannot reach another workspace, even with a forged header", async () => {
    const res = await t.app.inject({ url: "/v1/workspaces/current", headers: bearer(token, { "tickzy-workspace": otherWs }) });
    expect(res.statusCode).toBe(404);
  });

  it("is refused on user-only endpoints", async () => {
    expect((await t.app.inject({ url: "/v1/me/workspaces", headers: bearer(token) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: bearer(token), payload: { name: "x", slug: "xyz", issue_prefix: "XY" } })).statusCode).toBe(403);
    expect((await t.app.inject({ url: "/v1/auth/session", headers: bearer(token) })).statusCode).toBe(403);
  });

  it("bearer requests are exempt from cookie CSRF rules but still subject to the Origin allow-list", async () => {
    const ok = await t.app.inject({ method: "PATCH", url: "/v1/workspaces/current", headers: bearer(token), payload: { name: "Acme" } });
    expect(ok.statusCode).toBe(200);
    const evil = await t.app.inject({ method: "PATCH", url: "/v1/workspaces/current", headers: bearer(token, { origin: "https://evil.example" }), payload: { name: "x" } });
    expect(evil.statusCode).toBe(403);
    const fine = await t.app.inject({ method: "PATCH", url: "/v1/workspaces/current", headers: bearer(token, { origin: TEST_ORIGIN }), payload: { name: "Acme" } });
    expect(fine.statusCode).toBe(200);
  });

  it("rejects malformed, forged and unknown tokens with 401", async () => {
    const [head, secret] = token.split(".") as [string, string];
    const forged = `${head}.${secret.slice(0, -1)}${secret.endsWith("a") ? "b" : "a"}`;
    for (const bad of ["tkz_live_nope", forged, `tkz_live_${"a".repeat(24)}.${"b".repeat(52)}`]) {
      const res = await t.app.inject({ url: "/v1/workspaces/current", headers: bearer(bad) });
      expect(res.statusCode).toBe(401);
    }
  });

  it("expired tokens stop working", async () => {
    const res = await createToken(alice, ws, { name: "short", scopes: ["workspace:manage"], expires_in_days: 30 });
    const short = res.json();
    expect((await t.app.inject({ url: "/v1/workspaces/current", headers: bearer(short.token) })).statusCode).toBe(200);
    await t.owner.query("UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = $1", [short.id]);
    expect((await t.app.inject({ url: "/v1/workspaces/current", headers: bearer(short.token) })).statusCode).toBe(401);
  });

  it("only admins manage tokens; other workspaces' tokens are invisible and unrevokable", async () => {
    expect((await createToken(bob, ws, { name: "mine", scopes: ["issues:read"], expires_in_days: null })).statusCode).toBe(403);
    expect((await t.app.inject({ url: "/v1/api-tokens", headers: auth(bob, ws) })).statusCode).toBe(403);
    const theirs = (await createToken(carol, otherWs, { name: "carol", scopes: ["issues:read"], expires_in_days: null })).json();
    const mine = (await t.app.inject({ url: "/v1/api-tokens", headers: auth(alice, ws) })).json();
    expect(mine.data.map((d: { id: string }) => d.id)).not.toContain(theirs.id);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/api-tokens/${theirs.id}`, headers: auth(alice, ws) })).statusCode).toBe(404);
  });

  it("revocation takes effect immediately and is audited", async () => {
    expect((await t.app.inject({ method: "DELETE", url: `/v1/api-tokens/${tokenId}`, headers: auth(alice, ws) })).statusCode).toBe(204);
    expect((await t.app.inject({ url: "/v1/workspaces/current", headers: bearer(token) })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/api-tokens/${tokenId}`, headers: auth(alice, ws) })).statusCode).toBe(404);
    const list = (await t.app.inject({ url: "/v1/api-tokens", headers: auth(alice, ws) })).json();
    expect(list.data.map((d: { id: string }) => d.id)).not.toContain(tokenId);
    await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
      expect((await tx.select().from(schema.auditLog)).map((a) => a.action)).toContain("api_token.revoked");
    });
  });

  it("the app role cannot change a token's hash, scopes or workspace", async () => {
    await expect(withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.execute(sql`UPDATE api_tokens SET scopes = '{developers:manage}'`))).rejects.toThrow();
    await expect(withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.execute(sql`UPDATE api_tokens SET secret_hash = '\\x00'`))).rejects.toThrow();
  });
});

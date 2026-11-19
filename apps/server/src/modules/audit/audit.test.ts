import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let admin: string;
let agent: string;
let ws: string;
let otherWs: string;

beforeAll(async () => {
  t = await setupTestApp();
  admin = await t.createUser("admin@example.com");
  agent = await t.createUser("agent@example.com");
  const create = async (user: string, slug: string) =>
    (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(user), payload: { name: slug, slug, issue_prefix: "AU" } })).json().id as string;
  ws = await create(admin, "audit-ws");
  otherWs = await create(agent, "audit-other");
  await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
    await tx.insert(schema.memberships).values({ id: newId("membership"), workspaceId: ws, userId: agent, role: "agent" });
    // 30 more entries in ONE transaction: identical created_at, so paging must not rely on timestamps
    await tx.insert(schema.auditLog).values(
      Array.from({ length: 30 }, (_, i) => ({ id: newId("auditLog"), workspaceId: ws, actorType: "user" as const, actorId: admin, action: i % 2 ? "member.invited" : "settings.changed" })),
    );
  });
});
afterAll(async () => { await t.teardown(); });

const get = (url: string, user = admin, w = ws) => t.app.inject({ url, headers: auth(user, w) });

describe("GET /v1/audit-log (T-104)", () => {
  it("lists newest first and pages through every entry exactly once", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(`/v1/audit-log?limit=7${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      seen.push(...body.data.map((e: { id: string }) => e.id));
      cursor = body.next_cursor;
    } while (cursor);
    expect(seen).toHaveLength(31); // 30 + workspace.created
    expect(new Set(seen).size).toBe(31);
    expect([...seen].sort().reverse()).toEqual(seen);
  });

  it("filters by action and actor", async () => {
    const byAction = (await get("/v1/audit-log?action=member.invited&limit=100")).json();
    expect(byAction.data).toHaveLength(15);
    expect(byAction.data.every((e: { action: string }) => e.action === "member.invited")).toBe(true);
    const byActor = (await get(`/v1/audit-log?actor_id=${agent}`)).json();
    expect(byActor.data).toHaveLength(0);
  });

  it("filters by date range", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await get(`/v1/audit-log?from=${future}`)).json().data).toHaveLength(0);
  });

  it("is admin-only", async () => {
    const res = await get("/v1/audit-log", agent);
    expect(res.statusCode).toBe(403);
  });

  it("never shows another workspace's entries", async () => {
    const res = await get("/v1/audit-log?limit=100", agent, otherWs);
    const body = res.json();
    expect(body.data.map((e: { action: string }) => e.action)).toEqual(["workspace.created"]);
    expect((await get("/v1/audit-log?limit=100")).json().data.some((e: { target_id: string }) => e.target_id === otherWs)).toBe(false);
  });

  it("rejects tampered cursors", async () => {
    const res = await get(`/v1/audit-log?cursor=${Buffer.from("iss_bad").toString("base64url")}`);
    expect(res.statusCode).toBe(422);
  });
});

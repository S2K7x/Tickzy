import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string;
let bob: string;
let wsId: string;

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
});
afterAll(async () => { await t.teardown(); });

describe("workspaces API (FR-1.1)", () => {
  it("creates a workspace and makes the creator admin", async () => {
    const res = await t.app.inject({
      method: "POST", url: "/v1/workspaces", headers: auth(alice),
      payload: { name: "Acme Cloud", slug: "acme-cloud", issue_prefix: "ACME" },
    });
    expect(res.statusCode).toBe(201);
    const ws = res.json();
    expect(ws).toMatchObject({ name: "Acme Cloud", slug: "acme-cloud", issue_prefix: "ACME", region: "us" });
    expect(ws.id).toMatch(/^ws_/);
    wsId = ws.id;

    const mine = (await t.app.inject({ url: "/v1/me/workspaces", headers: auth(alice) })).json();
    expect(mine.data).toEqual([{ workspace_id: wsId, name: "Acme Cloud", slug: "acme-cloud", role: "admin" }]);
  });

  it("writes an audit entry and an outbox event in the same transaction", async () => {
    await withWorkspace(t.database.db, { workspaceId: wsId }, async (tx) => {
      const audit = await tx.select().from(schema.auditLog);
      expect(audit.map((a) => a.action)).toContain("workspace.created");
      const events = await tx.select().from(schema.outbox);
      expect(events.map((e) => e.type)).toEqual(["workspace.created"]);
      const counters = await tx.select().from(schema.workspaceCounters);
      expect(counters).toEqual([{ workspaceId: wsId, name: "issue", value: 0 }]);
    });
  });

  it("rejects a duplicate slug with 409", async () => {
    const res = await t.app.inject({
      method: "POST", url: "/v1/workspaces", headers: auth(bob),
      payload: { name: "Other", slug: "acme-cloud", issue_prefix: "OTH" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("conflict");
  });

  it("returns the current workspace to members", async () => {
    const res = await t.app.inject({ url: "/v1/workspaces/current", headers: auth(alice, wsId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(wsId);
  });

  it("hides the workspace from non-members (404, not 403)", async () => {
    const res = await t.app.inject({ url: "/v1/workspaces/current", headers: auth(bob, wsId) });
    expect(res.statusCode).toBe(404);
  });

  it("requires the Tickzy-Workspace header", async () => {
    const res = await t.app.inject({ url: "/v1/workspaces/current", headers: auth(alice) });
    expect(res.statusCode).toBe(422);
  });

  it("lets admins update settings and audits it", async () => {
    const res = await t.app.inject({
      method: "PATCH", url: "/v1/workspaces/current", headers: auth(alice, wsId), payload: { name: "Acme", issue_prefix: "AC" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Acme", issue_prefix: "AC" });
    const audit = await withWorkspace(t.database.db, { workspaceId: wsId }, (tx) => tx.select().from(schema.auditLog));
    expect(audit.map((a) => a.action)).toContain("workspace.updated");
  });

  it("forbids agents from updating workspace settings", async () => {
    await withWorkspace(t.database.db, { workspaceId: wsId }, (tx) =>
      tx.insert(schema.memberships).values({ id: newId("membership"), workspaceId: wsId, userId: bob, role: "agent" }),
    );
    const res = await t.app.inject({ method: "PATCH", url: "/v1/workspaces/current", headers: auth(bob, wsId), payload: { name: "Hacked" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
    const read = await t.app.inject({ url: "/v1/workspaces/current", headers: auth(bob, wsId) });
    expect(read.json().name).toBe("Acme");
  });

  it("rejects dev tokens when dev auth is disabled", async () => {
    const { buildApp } = await import("../../app.ts");
    const { testConfig } = await import("../../test-helpers.ts");
    const prod = await buildApp({ config: { ...testConfig, AUTH_DEV_MODE: false }, database: t.database, email: t.email });
    const res = await prod.inject({ url: "/v1/me/workspaces", headers: auth(alice) });
    expect(res.statusCode).toBe(401);
    await prod.close();
  });

  it("does not leak the database setting between requests", async () => {
    const res = await t.database.db.execute(sql`SELECT current_setting('app.workspace_id', true) AS v`);
    expect(res.rows[0]!.v ?? "").toBe("");
  });
});

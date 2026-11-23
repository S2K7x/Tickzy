import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";
import { defaultLabelColor } from "./service.ts";

/** Labels and teams (FR-3.3, T-209b). */
let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string; let vera: string; let carol: string;
let ws: string; let otherWs: string;
const H = (u = alice, w = ws) => auth(u, w);
const labels = async (u = alice, w = ws) => (await t.app.inject({ url: "/v1/labels", headers: H(u, w) })).json().data as { id: string; name: string; color: string }[];
const mkLabel = (payload: Record<string, unknown>, u = alice) => t.app.inject({ method: "POST", url: "/v1/labels", headers: H(u), payload });

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  vera = await t.createUser("vera@example.com");
  carol = await t.createUser("carol@example.com");
  ws = (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: "acme", slug: "acme", issue_prefix: "ACME" } })).json().id;
  otherWs = (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(carol), payload: { name: "other", slug: "other", issue_prefix: "OTH" } })).json().id;
  await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
    await tx.insert(schema.memberships).values({ id: newId("membership"), workspaceId: ws, userId: vera, role: "viewer" });
    await tx.insert(schema.teams).values([
      { id: newId("team"), workspaceId: ws, name: "tier 2" },
      { id: newId("team"), workspaceId: ws, name: "Billing" },
      { id: newId("team"), workspaceId: ws, name: "Old", archivedAt: new Date() },
    ]);
  });
  await withWorkspace(t.database.db, { workspaceId: otherWs }, (tx) => tx.insert(schema.teams).values({ id: newId("team"), workspaceId: otherWs, name: "Secret team" }));
});
afterAll(async () => { await t.teardown(); });

describe("labels", () => {
  it("creates labels (name tidied, colour defaulted and stable) and lists them by name", async () => {
    const before = (await labels()).length;
    const res = await mkLabel({ name: "  needs   repro " });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "needs repro", color: defaultLabelColor("needs repro"), parent_id: null });
    expect((await mkLabel({ name: "Billing", color: "#AABBCC" })).json().color).toBe("#aabbcc");
    const names = (await labels()).map((l) => l.name);
    expect(names.length).toBe(before + 2);
    expect(names).toEqual([...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  });

  it("refuses a duplicate name regardless of case (409) and bad input (422)", async () => {
    await mkLabel({ name: "Urgent-ish" });
    const dup = await mkLabel({ name: "urgent-ISH" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.message).toContain("already exists");
    expect((await mkLabel({ name: "" })).statusCode).toBe(422);
    expect((await mkLabel({ name: "x".repeat(61) })).statusCode).toBe(422);
    expect((await mkLabel({ name: "ok", color: "red" })).statusCode).toBe(422);
  });

  it("viewers can read but not create; other workspaces never see them", async () => {
    expect((await labels(vera)).length).toBeGreaterThan(0);
    expect((await mkLabel({ name: "from viewer" }, vera)).statusCode).toBe(403);
    expect((await labels(carol, otherWs)).map((l) => l.name)).not.toContain("needs repro");
  });
});

describe("teams", () => {
  it("lists active teams of this workspace only, by name", async () => {
    const res = await t.app.inject({ url: "/v1/teams", headers: H() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((x: { name: string }) => x.name)).toEqual(["Billing", "tier 2"]);
    expect((await t.app.inject({ url: "/v1/teams", headers: H(vera) })).statusCode).toBe(200);
  });
});

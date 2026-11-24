import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";

/** Saved views (T-211, FR-3.7). */
let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string; // admin
let bob: string; // agent
let carl: string; // collaborator
let ws: string; let otherWs: string;
const mem: Record<string, string> = {};
let lblBug: string;
const H = (u = alice, w = ws) => auth(u, w);
const post = (payload: Record<string, unknown>, u = alice) => t.app.inject({ method: "POST", url: "/v1/views", headers: H(u), payload });
const patch = (id: string, payload: Record<string, unknown>, u = alice) => t.app.inject({ method: "PATCH", url: `/v1/views/${id}`, headers: H(u), payload });
const del = (id: string, u = alice) => t.app.inject({ method: "DELETE", url: `/v1/views/${id}`, headers: H(u) });
const list = async (u = alice) => (await t.app.inject({ url: "/v1/views", headers: H(u) })).json().data as { id: string; name: string; shared: boolean; count: number; can_edit: boolean; owner_name: string }[];
const issue = (payload: Record<string, unknown>) => t.app.inject({ method: "POST", url: "/v1/issues", headers: H(), payload });

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
  carl = await t.createUser("carl@example.com");
  const mk = async (slug: string, prefix: string, u = alice) => (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(u), payload: { name: slug, slug, issue_prefix: prefix } })).json().id as string;
  ws = await mk("acme", "ACME");
  otherWs = await mk("other", "OTH", carl);
  lblBug = newId("label");
  await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
    for (const [u, role] of [[bob, "agent"], [carl, "collaborator"]] as const) await tx.insert(schema.memberships).values({ id: newId("membership"), workspaceId: ws, userId: u, role });
    for (const m of await tx.select().from(schema.memberships)) mem[m.userId] = m.id;
    await tx.insert(schema.labels).values({ id: lblBug, workspaceId: ws, name: "bug" });
  });
  await issue({ title: "Urgent bug for Bob", priority: "urgent", assignee_membership_id: mem[bob], labels: [lblBug] });
  await issue({ title: "High one, unassigned", priority: "high" });
  await issue({ title: "Normal SSO question", priority: "normal" });
});
afterAll(async () => { await t.teardown(); });

describe("saved views (T-211)", () => {
  it("saves a personal view; its count is the number of matching issues and follows changes", async () => {
    const res = await post({ name: "Hot", base: "open", filters: { priority: "urgent,high" }, sort: "priority" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "Hot", shared: false, base: "open", filters: { priority: "urgent,high" }, sort: "priority", count: 2, can_edit: true, owner_user_id: alice, owner_name: "alice@example.com" });
    expect(res.json().id).toMatch(/^vw_/);
    await issue({ title: "Another urgent", priority: "urgent" });
    expect((await list()).find((v) => v.name === "Hot")!.count).toBe(3);
  });

  it("counts use the same rules as the list: base view (Mine for the caller), label and text filters", async () => {
    const mine = (await post({ name: "My bugs", base: "mine", filters: { label: lblBug } }, bob)).json();
    expect(mine.count).toBe(1);
    const sso = (await post({ name: "SSO", base: "open", filters: { q: "sso" } })).json();
    expect(sso.count).toBe(1);
    const mineForAlice = (await post({ name: "Mine", base: "mine" })).json();
    expect(mineForAlice.count).toBe(0);
  });

  it("personal views are invisible to others — through the API and at the database (RLS)", async () => {
    const v = (await post({ name: "Alice only", base: "open" })).json();
    expect((await list(bob)).map((x) => x.name)).not.toContain("Alice only");
    expect((await t.app.inject({ url: `/v1/views/${v.id}`, headers: H(bob) })).statusCode).toBe(404);
    expect((await patch(v.id, { name: "hijack" }, bob)).statusCode).toBe(404);
    expect((await del(v.id, bob)).statusCode).toBe(404);
    const rows = await withWorkspace(t.database.db, { workspaceId: ws, userId: bob }, (tx) => tx.select().from(schema.savedViews).where(eq(schema.savedViews.id, v.id)));
    expect(rows).toHaveLength(0);
    const own = await withWorkspace(t.database.db, { workspaceId: ws, userId: alice }, (tx) => tx.select().from(schema.savedViews).where(eq(schema.savedViews.id, v.id)));
    expect(own).toHaveLength(1);
    // Inserting a personal view owned by someone else is refused by the policy.
    await expect(withWorkspace(t.database.db, { workspaceId: ws, userId: bob }, (tx) => tx.insert(schema.savedViews).values({ id: newId("savedView"), workspaceId: ws, ownerUserId: alice, name: "forged", base: "open" }))).rejects.toThrow();
  });

  it("shared views: agents create them, every member sees them, only owner or admin may change them (audited)", async () => {
    const shared = (await post({ name: "Team triage", base: "on-us", shared: true }, bob)).json();
    expect(shared.shared).toBe(true);
    const seen = (await list(carl)).find((v) => v.id === shared.id)!;
    expect(seen).toMatchObject({ shared: true, can_edit: false, owner_name: "bob@example.com" });
    expect((await patch(shared.id, { name: "Mine now" }, carl)).statusCode).toBe(403);
    expect((await del(shared.id, carl)).statusCode).toBe(403);
    expect((await patch(shared.id, { sort: "oldest" }, alice)).statusCode).toBe(200); // admin
    expect((await patch(shared.id, { name: "Triage (team)" }, bob)).statusCode).toBe(200); // owner
    const audits = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, shared.id)));
    expect(audits.map((a) => a.action).sort()).toEqual(["saved_view.created", "saved_view.updated", "saved_view.updated"]);
    const events = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.outbox).where(eq(schema.outbox.type, "saved_view.changed")));
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect((await del(shared.id, alice)).statusCode).toBe(204);
    expect((await list(bob)).map((v) => v.id)).not.toContain(shared.id);
  });

  it("collaborators keep personal views but cannot share; sharing later needs issues:write too", async () => {
    expect((await post({ name: "Carl's", base: "open" }, carl)).statusCode).toBe(201);
    expect((await post({ name: "Carl shared", base: "open", shared: true }, carl)).statusCode).toBe(403);
    const v = (await list(carl)).find((x) => x.name === "Carl's")!;
    expect((await patch(v.id, { shared: true }, carl)).statusCode).toBe(403);
    expect((await patch(v.id, { shared: true }, bob)).statusCode).toBe(404); // bob cannot even see it
  });

  it("names are unique per owner (personal) and per workspace (shared), case-insensitively", async () => {
    await post({ name: "Dupes", base: "open" });
    expect((await post({ name: "dupes", base: "done" })).statusCode).toBe(409);
    expect((await post({ name: "Dupes", base: "open" }, bob)).statusCode).toBe(201); // another owner
    await post({ name: "Shared dupes", base: "open", shared: true });
    const clash = await post({ name: "SHARED DUPES", base: "open", shared: true }, bob);
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.message).toContain("shared view");
    const other = (await post({ name: "Rename me", base: "open" })).json();
    expect((await patch(other.id, { name: "DUPES" })).statusCode).toBe(409);
  });

  it("validates base, sort, name and filters (same rules as the issue list)", async () => {
    expect((await post({ name: "x", base: "everything" })).statusCode).toBe(422);
    expect((await post({ name: "x", base: "open", sort: "random" })).statusCode).toBe(422);
    expect((await post({ name: "", base: "open" })).statusCode).toBe(422);
    expect((await post({ name: "x".repeat(61), base: "open" })).statusCode).toBe(422);
    expect((await post({ name: "x", base: "open", filters: { priority: "critical" } })).statusCode).toBe(422);
    expect((await post({ name: "x", base: "open", filters: { channel: "fax" } })).statusCode).toBe(422);
    expect((await post({ name: "x", base: "open", filters: { status: "resolved" } })).statusCode).toBe(422); // unknown key
    expect((await patch("vw_01JD0000000000000000000000", {})).statusCode).toBe(422);
  });

  it("API tokens cannot use saved views; other workspaces never see them", async () => {
    const tok = (await t.app.inject({ method: "POST", url: "/v1/api-tokens", headers: H(), payload: { name: "ci", scopes: ["issues:read"], expires_in_days: 30 } })).json().token;
    expect(tok).toMatch(/^tkz_live_/);
    expect((await t.app.inject({ url: "/v1/views", headers: { authorization: `Bearer ${tok}` } })).statusCode).toBe(403);
    expect((await t.app.inject({ url: "/v1/views", headers: auth(carl, otherWs) })).json().data).toEqual([]);
  });
});

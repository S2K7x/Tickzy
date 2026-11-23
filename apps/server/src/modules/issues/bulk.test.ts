import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";

/** Bulk actions (FR-3.10, T-209b): POST /v1/issues/bulk. */
let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string; let bob: string; let viewer: string;
let ws: string; let otherWs: string;
const mem: Record<string, string> = {};
let teamId: string; let lblBug: string; let lblVip: string;
const H = (u = alice, w = ws) => auth(u, w);
const create = async (title: string, payload: Record<string, unknown> = {}, w = ws) =>
  (await t.app.inject({ method: "POST", url: "/v1/issues", headers: H(alice, w), payload: { title, ...payload } })).json() as { id: string; key: string };
const bulk = (issues: string[], changes: Record<string, unknown>, u = alice) => t.app.inject({ method: "POST", url: "/v1/issues/bulk", headers: H(u), payload: { issues, changes } });
const get = async (ref: string) => (await t.app.inject({ url: `/v1/issues/${ref}`, headers: H() })).json();
const timelineTypes = async (ref: string) => (await t.app.inject({ url: `/v1/issues/${ref}/timeline`, headers: H() })).json().data
  .filter((i: { kind: string }) => i.kind === "event").map((i: { event: { type: string } }) => i.event.type);

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
  viewer = await t.createUser("vera@example.com");
  const mk = async (slug: string, prefix: string) => (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: slug, slug, issue_prefix: prefix } })).json().id as string;
  ws = await mk("acme", "ACME");
  otherWs = await mk("other", "OTH");
  teamId = newId("team"); lblBug = newId("label"); lblVip = newId("label");
  await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
    await tx.insert(schema.memberships).values([
      { id: newId("membership"), workspaceId: ws, userId: bob, role: "agent" },
      { id: newId("membership"), workspaceId: ws, userId: viewer, role: "viewer" },
    ]);
    for (const m of await tx.select().from(schema.memberships)) mem[m.userId] = m.id;
    await tx.insert(schema.teams).values({ id: teamId, workspaceId: ws, name: "Tier 1" });
    await tx.insert(schema.labels).values([{ id: lblBug, workspaceId: ws, name: "bug" }, { id: lblVip, workspaceId: ws, name: "vip" }]);
  });
});
afterAll(async () => { await t.teardown(); });

describe("bulk issue actions (FR-3.10)", () => {
  it("assigns, sets priority and team on many issues; each gets its own timeline event and version bump", async () => {
    const a = await create("One"); const b = await create("Two"); const c = await create("Three");
    const res = await bulk([a.key, b.id, c.key], { assignee_membership_id: mem[bob], priority: "urgent", team_id: teamId });
    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, true]);
    for (const r of results) expect(r.issue).toMatchObject({ priority: "urgent", team_id: teamId, assignee: { user_id: bob }, version: 2 });
    expect(await timelineTypes(a.key)).toEqual(["issue.created", "issue.assigned", "issue.updated"]);
  });

  it("adds and removes labels on top of each issue's own labels", async () => {
    const a = await create("Labelled", { labels: [lblBug] }); const b = await create("Plain");
    const res = await bulk([a.key, b.key], { add_labels: [lblVip], remove_labels: [lblBug] });
    const [ra, rb] = res.json().results;
    expect(ra.issue.labels.map((l: { name: string }) => l.name)).toEqual(["vip"]);
    expect(rb.issue.labels.map((l: { name: string }) => l.name)).toEqual(["vip"]);
    expect(await timelineTypes(a.key)).toContain("issue.labels_changed");
  });

  it("one refusal does not undo the others: a closed issue fails, the rest resolve", async () => {
    const open1 = await create("Open one"); const closed = await create("Done"); const open2 = await create("Open two");
    expect((await t.app.inject({ method: "PATCH", url: `/v1/issues/${closed.key}`, headers: H(), payload: { status: "closed" } })).statusCode).toBe(200);
    const res = await bulk([open1.key, closed.key, open2.key, "ACME-9999"], { status: "resolved" });
    expect(res.statusCode).toBe(200);
    const results = res.json().results as { ref: string; ok: boolean; error?: { code: string } }[];
    expect(results.map((r) => [r.ref, r.ok, r.error?.code ?? null])).toEqual([
      [open1.key, true, null], [closed.key, false, "conflict"], [open2.key, true, null], ["ACME-9999", false, "not_found"],
    ]);
    expect((await get(open1.key)).status.category).toBe("resolved");
    expect((await get(open2.key)).status.category).toBe("resolved");
    expect((await get(closed.key)).status.category).toBe("closed");
  });

  it("already in the target status is a no-op success (no event, no version bump)", async () => {
    const a = await create("Resolve me");
    await bulk([a.key], { status: "resolved" });
    const before = await get(a.key);
    const [r] = (await bulk([a.key], { status: "resolved" })).json().results;
    expect(r.ok).toBe(true);
    expect(r.issue.version).toBe(before.version);
  });

  it("invalid references fail the whole request with 422 and change nothing", async () => {
    const a = await create("Untouched");
    const bad = await bulk([a.key], { priority: "low", add_labels: ["lbl_01JD00000000000000000NOPE0"] });
    expect(bad.statusCode).toBe(422);
    expect((await bulk([a.key], { assignee_membership_id: mem[viewer] })).statusCode).toBe(422); // viewers cannot be assigned
    expect((await get(a.key)).priority).not.toBe("low");
  });

  it("validates the request: empty changes, unknown fields, too many issues, status + status_id", async () => {
    const a = await create("V");
    expect((await bulk([a.key], {})).statusCode).toBe(422);
    expect((await bulk([a.key], { add_labels: [] })).statusCode).toBe(422);
    expect((await bulk([a.key], { title: "renamed" })).statusCode).toBe(422);
    expect((await bulk([], { priority: "low" })).statusCode).toBe(422);
    expect((await bulk(Array.from({ length: 101 }, (_, i) => `ACME-${i + 1}`), { priority: "low" })).statusCode).toBe(422);
    expect((await bulk([a.key], { status: "resolved", status_id: "sts_x" })).statusCode).toBe(422);
  });

  it("needs issues:write; another workspace's issues are simply not found", async () => {
    const a = await create("Mine");
    expect((await bulk([a.key], { priority: "low" }, viewer)).statusCode).toBe(403);
    const foreign = await create("Theirs", {}, otherWs);
    const [r] = (await bulk([foreign.id], { priority: "low" })).json().results;
    expect(r).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("deduplicates refs", async () => {
    const a = await create("Dup");
    const { results } = (await bulk([a.key, a.key], { priority: "high" })).json();
    expect(results).toHaveLength(1);
  });
});

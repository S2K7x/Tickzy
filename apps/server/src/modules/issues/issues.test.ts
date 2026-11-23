import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string; // admin
let bob: string; // agent
let carl: string; // collaborator
let ws: string;
let otherWs: string;
const mem: Record<string, string> = {};
let teamId: string;
let labelBug: string;
let labelBilling: string;
let accountId: string;

const H = (u = alice, w = ws) => auth(u, w);
const create = (payload: Record<string, unknown>, u = alice, w = ws) => t.app.inject({ method: "POST", url: "/v1/issues", headers: H(u, w), payload });
const patch = (ref: string, payload: Record<string, unknown>, u = alice) => t.app.inject({ method: "PATCH", url: `/v1/issues/${ref}`, headers: H(u), payload });
const list = async (qs: string, u = alice) => {
  const res = await t.app.inject({ url: `/v1/issues${qs ? `?${qs}` : ""}`, headers: H(u) });
  expect(res.statusCode).toBe(200);
  return res.json() as { data: { key: string; title: string; priority: string; id: string }[]; next_cursor: string | null };
};
const allPages = async (qs: string, limit = 2) => {
  const keys: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await list(`${qs}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
    keys.push(...page.data.map((i) => i.key));
    cursor = page.next_cursor;
  } while (cursor);
  return keys;
};
const timelineTypes = async (ref: string) => (await t.app.inject({ url: `/v1/issues/${ref}/timeline`, headers: H() })).json().data
  .map((i: { kind: string; event?: { type: string } }) => (i.kind === "event" ? i.event!.type : "message"));

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
  carl = await t.createUser("carl@example.com");
  const mk = async (slug: string, prefix: string) => (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: slug, slug, issue_prefix: prefix } })).json().id as string;
  ws = await mk("acme", "ACME");
  otherWs = await mk("other", "OTH");
  teamId = newId("team");
  labelBug = newId("label");
  labelBilling = newId("label");
  await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
    for (const [u, role] of [[bob, "agent"], [carl, "collaborator"]] as const) await tx.insert(schema.memberships).values({ id: newId("membership"), workspaceId: ws, userId: u, role });
    for (const m of await tx.select().from(schema.memberships)) mem[m.userId] = m.id;
    await tx.insert(schema.teams).values({ id: teamId, workspaceId: ws, name: "Tier 1" });
    await tx.insert(schema.labels).values([{ id: labelBug, workspaceId: ws, name: "bug", color: "#ff0000" }, { id: labelBilling, workspaceId: ws, name: "billing" }]);
    await tx.insert(schema.customFieldDefs).values({ id: newId("customField"), workspaceId: ws, entity: "issue", key: "plan", label: "Plan", type: "select", options: [{ id: "pro", label: "Pro" }] });
  });
  accountId = (await t.app.inject({ method: "POST", url: "/v1/accounts", headers: H(), payload: { name: "Globex" } })).json().id;
});
afterAll(async () => { await t.teardown(); });

describe("create & read (T-204)", () => {
  it("creates an issue with key, Triage status, assignee, team, account, labels and fields; timeline records it", async () => {
    const res = await create({ title: "Webhooks failing", priority: "high", assignee_membership_id: mem[bob], team_id: teamId, account_id: accountId, labels: [labelBug], custom: { plan: "pro" } });
    expect(res.statusCode).toBe(201);
    const i = res.json();
    expect(i).toMatchObject({
      key: "ACME-1", number: 1, title: "Webhooks failing", priority: "high", channel: "ui", team_id: teamId, version: 1,
      status: { category: "triage", name: "Triage" }, assignee: { membership_id: mem[bob], user_id: bob, email: "bob@example.com" },
      account: { id: accountId, name: "Globex" }, labels: [{ id: labelBug, name: "bug", color: "#ff0000" }], fields: { plan: "pro" }, sla: [],
    });
    expect(await timelineTypes("ACME-1")).toEqual(["issue.created", "issue.assigned"]);
  });

  it("reads by id, key (any case) or number; another prefix or workspace gives 404", async () => {
    const byKey = (await t.app.inject({ url: "/v1/issues/acme-1", headers: H() })).json();
    expect((await t.app.inject({ url: `/v1/issues/${byKey.id}`, headers: H() })).json().key).toBe("ACME-1");
    expect((await t.app.inject({ url: "/v1/issues/1", headers: H() })).json().id).toBe(byKey.id);
    expect((await t.app.inject({ url: "/v1/issues/OTH-1", headers: H() })).statusCode).toBe(404);
    expect((await t.app.inject({ url: "/v1/issues/ACME-999", headers: H() })).statusCode).toBe(404);
    expect((await t.app.inject({ url: `/v1/issues/${byKey.id}`, headers: H(alice, otherWs) })).statusCode).toBe(404);
  });

  it("validates references and fields with 422", async () => {
    const otherLabel = newId("label");
    await withWorkspace(t.database.db, { workspaceId: otherWs }, (tx) => tx.insert(schema.labels).values({ id: otherLabel, workspaceId: otherWs, name: "theirs" }));
    const cases: [Record<string, unknown>, string][] = [
      [{ title: "" }, "title"],
      [{ title: "x", assignee_membership_id: mem[carl] }, "assignee_membership_id"],      // collaborators cannot be assigned
      [{ title: "x", assignee_membership_id: newId("membership") }, "assignee_membership_id"],
      [{ title: "x", labels: [otherLabel] }, "labels"],                                    // another workspace's label
      [{ title: "x", team_id: newId("team") }, "team_id"],
      [{ title: "x", custom: { plan: "enterprise" } }, "custom.plan"],
      [{ title: "x", priority: "critical" }, "priority"],
    ];
    for (const [payload, path] of cases) {
      const res = await create(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
      expect(JSON.stringify(res.json().error.details)).toContain(path);
    }
  });

  it("roles and tokens: collaborators read but cannot write; tokens follow scopes and create `api` issues", async () => {
    expect((await list("", carl)).data.length).toBeGreaterThan(0);
    expect((await create({ title: "nope" }, carl)).statusCode).toBe(403);
    const readTok = (await t.app.inject({ method: "POST", url: "/v1/api-tokens", headers: H(), payload: { name: "r", scopes: ["issues:read"], expires_in_days: null } })).json().token;
    const writeTok = (await t.app.inject({ method: "POST", url: "/v1/api-tokens", headers: H(), payload: { name: "w", scopes: ["issues:write"], expires_in_days: null } })).json().token;
    expect((await t.app.inject({ url: "/v1/issues", headers: { authorization: `Bearer ${readTok}` } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "POST", url: "/v1/issues", headers: { authorization: `Bearer ${readTok}` }, payload: { title: "x" } })).statusCode).toBe(403);
    const viaApi = await t.app.inject({ method: "POST", url: "/v1/issues", headers: { authorization: `Bearer ${writeTok}` }, payload: { title: "From the API" } });
    expect(viaApi.json()).toMatchObject({ channel: "api", key: "ACME-2" });
    expect((await t.app.inject({ url: "/v1/issues?assignee=me", headers: { authorization: `Bearer ${readTok}` } })).statusCode).toBe(422);
  });
});

describe("update (T-204)", () => {
  it("records each kind of change on the timeline and bumps the version once per update", async () => {
    const res = await patch("ACME-1", { title: "Webhooks failing for EU", priority: "urgent", labels: [labelBilling], assignee_membership_id: null, version: 1 });
    expect(res.statusCode).toBe(200);
    const i = res.json();
    expect(i).toMatchObject({ title: "Webhooks failing for EU", priority: "urgent", assignee: null, labels: [{ id: labelBilling }], version: 2 });
    expect(await timelineTypes("ACME-1")).toEqual(["issue.created", "issue.assigned", "issue.assigned", "issue.updated", "issue.labels_changed"]);
    const tl = (await t.app.inject({ url: "/v1/issues/ACME-1/timeline", headers: H() })).json().data;
    expect(tl[3].event.data.changes).toEqual({ title: { from: "Webhooks failing", to: "Webhooks failing for EU" }, priority: { from: "high", to: "urgent" } });
    expect(tl[3].event.actor).toEqual({ type: "user", id: alice });
  });

  it("a no-op update changes nothing", async () => {
    const before = (await t.app.inject({ url: "/v1/issues/ACME-1", headers: H() })).json();
    const after = (await patch("ACME-1", { priority: "urgent", labels: [labelBilling] })).json();
    expect(after.version).toBe(before.version);
  });

  it("status changes go through the lifecycle rules; stale versions and closed issues conflict", async () => {
    const resolved = (await patch("ACME-1", { status: "resolved" })).json();
    expect(resolved).toMatchObject({ status: { category: "resolved", name: "Resolved" } });
    expect(resolved.resolved_at).not.toBeNull();
    expect((await patch("ACME-1", { title: "stale", version: 1 })).statusCode).toBe(409);
    await patch("ACME-1", { status: "closed" });
    expect((await patch("ACME-1", { status: "waiting_on_us" })).statusCode).toBe(409);
    expect((await patch("ACME-1", { status: "closed", status_id: "sts_x" })).statusCode).toBe(422);
    expect((await patch("ACME-1", { version: 3 })).statusCode).toBe(422); // nothing to change
  });
});

describe("list: filters, sorts and keyset pagination (T-204)", () => {
  beforeAll(async () => {
    const specs: Record<string, unknown>[] = [
      { title: "Login loop on Safari", priority: "low", account_id: accountId },
      { title: "Invoice PDF missing VAT", priority: "high", labels: [labelBilling], assignee_membership_id: mem[alice] },
      { title: "API rate limit too low", priority: "urgent", team_id: teamId },
      { title: "Typo on pricing page", priority: "normal", assignee_membership_id: mem[bob] },
      { title: "Export to CSV times out", priority: "high", category: "waiting_on_customer" },
    ];
    for (const s of specs) expect((await create(s)).statusCode).toBe(201); // ACME-3 … ACME-7
  });

  it("filters by status, priority, assignee, team, account, label, channel and text/key", async () => {
    const keys = async (qs: string) => (await list(qs)).data.map((i) => i.key).sort();
    expect(await keys("status=waiting_on_customer")).toEqual(["ACME-7"]);
    expect(await keys("status=closed,waiting_on_customer")).toEqual(["ACME-1", "ACME-7"]);
    expect(await keys("priority=urgent")).toEqual(["ACME-1", "ACME-5"]); // ACME-1 became urgent in the update tests
    expect(await keys("assignee=me")).toEqual(["ACME-4"]);
    expect(await keys(`assignee=${mem[bob]}`)).toEqual(["ACME-6"]);
    expect((await keys("assignee=none")).length).toBe(5);
    expect(await keys(`team=${teamId}`)).toEqual(["ACME-1", "ACME-5"]);
    expect(await keys(`account=${accountId}`)).toEqual(["ACME-1", "ACME-3"]);
    expect(await keys(`label=${labelBilling}`)).toEqual(["ACME-1", "ACME-4"]);
    expect(await keys("channel=api")).toEqual(["ACME-2"]);
    expect(await keys("q=pdf")).toEqual(["ACME-4"]);
    expect(await keys("q=ACME-6")).toEqual(["ACME-6"]);
    expect(await keys("q=100%25")).toEqual([]); // wildcard is literal
    expect((await t.app.inject({ url: "/v1/issues?status=open", headers: H() })).statusCode).toBe(422);
    expect((await t.app.inject({ url: "/v1/issues?cursor=nope", headers: H() })).statusCode).toBe(422);
  });

  it("pages every sort exactly once, in order", async () => {
    expect(await allPages("sort=newest")).toEqual(["ACME-7", "ACME-6", "ACME-5", "ACME-4", "ACME-3", "ACME-2", "ACME-1"]);
    expect(await allPages("sort=oldest", 3)).toEqual(["ACME-1", "ACME-2", "ACME-3", "ACME-4", "ACME-5", "ACME-6", "ACME-7"]);
    // priority rank asc, then newest first within a priority (mixed directions)
    expect(await allPages("sort=priority")).toEqual(["ACME-5", "ACME-1", "ACME-7", "ACME-4", "ACME-6", "ACME-2", "ACME-3"]);
    const updated = await allPages("sort=updated");
    expect(updated[0]).toBe("ACME-7");
    expect(updated.length).toBe(7);
    expect(new Set(updated).size).toBe(7);
    await patch("ACME-3", { title: "Login loop on Safari 18" });
    expect((await allPages("sort=updated"))[0]).toBe("ACME-3");
    expect(await allPages("sort=newest&priority=high,urgent", 1)).toEqual(["ACME-7", "ACME-5", "ACME-4", "ACME-1"]);
  });

  it("issues of other workspaces never appear", async () => {
    await create({ title: "Theirs" }, alice, otherWs);
    expect((await list("q=Theirs")).data).toEqual([]);
  });
});

describe("timeline (T-204)", () => {
  it("interleaves messages (incl. internal notes) and events chronologically", async () => {
    const issue = (await t.app.inject({ url: "/v1/issues/ACME-6", headers: H() })).json();
    await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
      const cnv = newId("conversation");
      await tx.insert(schema.conversations).values({ id: cnv, workspaceId: ws, channelKind: "ui" });
      await tx.insert(schema.messages).values([
        { id: newId("message"), workspaceId: ws, conversationId: cnv, issueId: issue.id, direction: "in", visibility: "public", authorType: "contact", source: "email", deliveryState: "received", bodyText: "pricing page says 'teh'" },
        { id: newId("message"), workspaceId: ws, conversationId: cnv, issueId: issue.id, direction: "out", visibility: "internal", authorType: "member", authorId: alice, source: "ui", bodyText: "easy fix" },
      ]);
      const [row] = await tx.select().from(schema.messages).where(eq(schema.messages.bodyText, "easy fix"));
      expect(row!.deliveryState).toBeNull();
    });
    const tl = (await t.app.inject({ url: "/v1/issues/ACME-6/timeline", headers: H(carl) })).json();
    expect(tl.truncated).toBe(false);
    expect(tl.data.map((i: { kind: string }) => i.kind)).toEqual(["event", "event", "message", "message"]);
    expect(tl.data[3].message).toMatchObject({ visibility: "internal", body: { text: "easy fix" } });
  });
});

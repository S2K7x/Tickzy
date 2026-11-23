import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema, withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";
import { recordInboundMessage, titleFrom, type InboundMessage } from "./inbound.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string;
let ws: string;
let globex: string;
let n = 0;

const H = () => auth(alice, ws);
const issue = async (ref: string) => (await t.app.inject({ url: `/v1/issues/${ref}`, headers: H() })).json();
const reply = (ref: string, visibility: "public" | "internal", body = "reply") => t.app.inject({ method: "POST", url: `/v1/issues/${ref}/messages`, headers: H(), payload: { body, visibility } });
const setStatus = (ref: string, status: string) => t.app.inject({ method: "PATCH", url: `/v1/issues/${ref}`, headers: H(), payload: { status } });
const inbound = (thread: string, over: Partial<InboundMessage> = {}) => withWorkspace(t.database.db, { workspaceId: ws }, (tx) => recordInboundMessage(tx, ws, {
  channel: "email", threadKey: thread, externalId: `<m${++n}@customer>`, sender: { kind: "email", key: "hank@globex.com", name: "Hank" }, body: "Exports fail with a 500", ...over,
}));
const events = async (issueId: string) => withWorkspace(t.database.db, { workspaceId: ws }, (tx) =>
  tx.select().from(schema.issueEvents).where(eq(schema.issueEvents.issueId, issueId)).orderBy(asc(schema.issueEvents.id)));

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  ws = (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: "Acme", slug: "acme", issue_prefix: "ACME" } })).json().id;
  globex = (await t.app.inject({ method: "POST", url: "/v1/accounts", headers: H(), payload: { name: "Globex", domains: ["globex.com"] } })).json().id;
});
afterAll(async () => { await t.teardown(); });

describe("outbound: team replies (FR-3.2)", () => {
  it("the first public reply hands the turn to the customer and stamps first response — as a system event with a reason", async () => {
    await t.app.inject({ method: "POST", url: "/v1/issues", headers: H(), payload: { title: "UI issue" } });
    const m = (await reply("ACME-1", "public", "On it")).json();
    const i = await issue("ACME-1");
    expect(i.status).toMatchObject({ category: "waiting_on_customer", name: "Waiting on customer" });
    expect(i.first_response_at).not.toBeNull();
    expect(i.version).toBe(2);
    const ev = (await events(i.id)).at(-1)!;
    expect(ev).toMatchObject({ type: "issue.status_changed", actorType: "system" });
    expect(ev.data).toMatchObject({ from: { category: "triage" }, to: { category: "waiting_on_customer" }, reason: "team_replied", message_id: m.id });
  });

  it("further replies keep the first response time; notes never change status or count as a response", async () => {
    const before = await issue("ACME-1");
    await reply("ACME-1", "public");
    expect((await issue("ACME-1")).first_response_at).toBe(before.first_response_at);
    await setStatus("ACME-1", "waiting_on_us");
    const noted = await t.app.inject({ method: "POST", url: "/v1/issues", headers: H(), payload: { title: "Notes only" } });
    await reply(noted.json().key, "internal", "investigating");
    const after = await issue(noted.json().key);
    expect(after).toMatchObject({ status: { category: "triage" }, first_response_at: null, version: 1 });
  });

  it("a reply on a blocked issue keeps it blocked", async () => {
    await setStatus("ACME-1", "blocked");
    await reply("ACME-1", "public", "Still waiting on engineering");
    expect((await issue("ACME-1")).status.category).toBe("blocked");
  });
});

describe("inbound: customer messages (FR-3.1, FR-3.2)", () => {
  it("a new thread opens an issue in Triage with requester, account (by email domain) and a title from the message", async () => {
    const r = await inbound("<t1@customer>", { body: "Hi,\n\nCSV export times out for large workspaces\nThanks" });
    expect(r).toMatchObject({ duplicate: false, effect: "issue_opened", notify: true });
    const i = (await t.app.inject({ url: `/v1/issues/${r.issueId}`, headers: H() })).json();
    expect(i).toMatchObject({ title: "CSV export times out for large workspaces", channel: "email", status: { category: "triage" }, account: { id: globex }, requester: { name: "Hank" } });
    expect(i.first_response_at).toBeNull();
    expect((await events(r.issueId))[0]).toMatchObject({ type: "issue.created", actorType: "contact" });
  });

  it("deduplicates provider message ids", async () => {
    const first = await inbound("<t1@customer>", { externalId: "<same@customer>" });
    const again = await inbound("<t1@customer>", { externalId: "<same@customer>" });
    expect(again).toMatchObject({ duplicate: true, messageId: first.messageId, issueId: first.issueId });
  });

  it("a full back-and-forth: customer → team reply → customer moves the turn each time", async () => {
    const r = await inbound("<t2@customer>", { body: "SSO login loops" });
    const key = (await t.app.inject({ url: `/v1/issues/${r.issueId}`, headers: H() })).json().key;
    await reply(key, "public", "Can you send a HAR file?");
    expect((await issue(key)).status.category).toBe("waiting_on_customer");
    const r2 = await inbound("<t2@customer>", { body: "Attached" });
    expect(r2).toMatchObject({ issueId: r.issueId, effect: "status_changed" });
    const i = await issue(key);
    expect(i.status.category).toBe("waiting_on_us");
    expect((await events(r.issueId)).at(-1)!.data).toMatchObject({ reason: "customer_replied" });
  });

  it("a customer message reopens a resolved issue and clears resolved_at", async () => {
    const r = await inbound("<t3@customer>", { body: "Webhook signature mismatch" });
    await setStatus(r.issueId, "resolved");
    expect((await issue(r.issueId)).resolved_at).not.toBeNull();
    await inbound("<t3@customer>", { body: "It's happening again" });
    const i = await issue(r.issueId);
    expect(i).toMatchObject({ status: { category: "waiting_on_us" }, resolved_at: null });
    expect((await events(r.issueId)).at(-1)!.data).toMatchObject({ reason: "reopened_by_customer" });
  });

  it("a customer message on a closed issue opens a linked follow-up; the closed issue is untouched; the thread continues on the follow-up", async () => {
    const r = await inbound("<t4@customer>", { body: "Billing address wrong" });
    await setStatus(r.issueId, "closed");
    const closed = await issue(r.issueId);
    const f = await inbound("<t4@customer>", { body: "Hello\nThe invoice still shows the old address" });
    expect(f.effect).toBe("followup_opened");
    expect(f.issueId).not.toBe(r.issueId);
    const follow = await issue(f.issueId);
    expect(follow).toMatchObject({ title: "The invoice still shows the old address", status: { category: "triage" }, requester: { name: "Hank" } });
    expect((await events(f.issueId)).map((e) => e.type)).toContain("issue.followup_of");
    expect((await events(r.issueId)).at(-1)).toMatchObject({ type: "issue.followup_opened", data: { issue_id: f.issueId } });
    expect(await issue(r.issueId)).toMatchObject({ status: { category: "closed" }, version: closed.version });
    const next = await inbound("<t4@customer>", { body: "any update?" });
    expect(next.issueId).toBe(f.issueId);
  });

  it("ignored issues stay ignored and never notify; blocked issues stay blocked", async () => {
    const ig = await inbound("<t5@customer>", { body: "Out of office auto-reply" });
    await setStatus(ig.issueId, "ignored");
    const again = await inbound("<t5@customer>", { body: "Still out of office" });
    expect(again).toMatchObject({ effect: "none", notify: false });
    expect((await issue(ig.issueId)).status.category).toBe("ignored");
    const bl = await inbound("<t6@customer>", { body: "API returns 502" });
    await setStatus(bl.issueId, "blocked");
    await inbound("<t6@customer>", { body: "any news?" });
    expect((await issue(bl.issueId)).status.category).toBe("blocked");
  });

  it("an endpoint's default account wins (e.g. a Slack Connect channel for one customer)", async () => {
    const initech = (await t.app.inject({ method: "POST", url: "/v1/accounts", headers: H(), payload: { name: "Initech" } })).json().id;
    const r = await inbound("1700000000.000100", { channel: "slack", sender: { kind: "slack", key: "T01:U99", name: "Peter" }, endpointDefaultAccountId: initech, body: "Dashboard is blank" });
    expect((await issue(r.issueId)).account).toMatchObject({ id: initech, name: "Initech" });
  });
});

describe("titleFrom", () => {
  it("skips greetings and truncates long lines", () => {
    expect(titleFrom("Hi team,\nExport broken", "x")).toBe("Export broken");
    expect(titleFrom("Good morning Acme support!\nBilling page 404s", "x")).toBe("Billing page 404s");
    expect(titleFrom("Hey, the API is down since 9am", "x")).toBe("Hey, the API is down since 9am"); // a real sentence is kept
    expect(titleFrom("\n\n", "Fallback")).toBe("Fallback");
    expect(titleFrom("a".repeat(200), "x")).toHaveLength(118);
  });
});

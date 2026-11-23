import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";
import { recordInboundMessage } from "../messages/inbound.ts";
import { sql } from "drizzle-orm";
import { HL_END, HL_START, searchIndexAvailable } from "./service.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string;
let ws: string;
let otherWs: string;
let n = 0;
const keys: Record<string, string> = {};

const H = (w = ws) => auth(alice, w);
const search = async (q: string, w = ws) => {
  const res = await t.app.inject({ url: `/v1/search?q=${encodeURIComponent(q)}`, headers: H(w) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { issues: { issue: { key: string; title: string }; match: { in: string; snippet: string | null } }[]; accounts: { name: string; domains: string[] }[]; query: { text: string } };
};
const found = async (q: string) => (await search(q)).issues.map((r) => r.issue.title);
const inbound = (thread: string, from: string, body: string, name = "") => withWorkspace(t.database.db, { workspaceId: ws }, (tx) =>
  recordInboundMessage(tx, ws, { channel: "email", threadKey: thread, externalId: `<m${++n}@x>`, sender: { kind: "email", key: from, name }, body }));
const keyOf = async (issueId: string) => (await t.app.inject({ url: `/v1/issues/${issueId}`, headers: H() })).json().key as string;

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@acme.test");
  const mk = async (slug: string) => (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: slug, slug, issue_prefix: "ACME" } })).json().id as string;
  ws = await mk("acme");
  otherWs = await mk("other");
  await t.app.inject({ method: "POST", url: "/v1/accounts", headers: H(), payload: { name: "Globex Corporation", domains: ["globex.com"] } });
  await t.app.inject({ method: "POST", url: "/v1/accounts", headers: H(), payload: { name: "Initech", domains: ["initech.io"] } });

  const a = await inbound("<t1>", "hank@globex.com", "Our webhook signature mismatch started after the deploy", "Hank Scorpio");
  keys.webhook = await keyOf(a.issueId);
  const b = await inbound("<t2>", "peter@initech.io", "CSV export times out for large reports", "Peter");
  keys.csv = await keyOf(b.issueId);
  const c = await inbound("<t3>", "hank@globex.com", "Invoice shows the wrong VAT number", "Hank Scorpio");
  keys.invoice = await keyOf(c.issueId);
  // A title-only match for "webhook": the title contains the word, no message does.
  keys.title = (await t.app.inject({ method: "POST", url: "/v1/issues", headers: H(), payload: { title: "Webhook dashboard redesign", priority: "urgent" } })).json().key;
  // Team reply and an internal note on the CSV issue; assign it to alice.
  const me = (await t.app.inject({ url: "/v1/members", headers: H() })).json().data[0].id;
  await t.app.inject({ method: "POST", url: `/v1/issues/${keys.csv}/messages`, headers: H(), payload: { body: "We raised the export timeout to 120 seconds", visibility: "public" } });
  await t.app.inject({ method: "POST", url: `/v1/issues/${keys.csv}/messages`, headers: H(), payload: { body: "Root cause: unindexed report query", visibility: "internal" } });
  await t.app.inject({ method: "PATCH", url: `/v1/issues/${keys.csv}`, headers: H(), payload: { assignee_membership_id: me } });
  await t.app.inject({ method: "PATCH", url: `/v1/issues/${keys.invoice}`, headers: H(), payload: { status: "resolved" } });
  // Ignored noise mentioning webhook.
  const noise = await inbound("<t4>", "bot@noise.dev", "Automatic reply: webhook digest");
  await t.app.inject({ method: "PATCH", url: `/v1/issues/${noise.issueId}`, headers: H(), payload: { status: "ignored" } });
  await withWorkspace(t.database.db, { workspaceId: otherWs }, (tx) =>
    recordInboundMessage(tx, otherWs, { channel: "email", threadKey: "<o1>", externalId: "<o1@x>", sender: { kind: "email", key: "x@y.io" }, body: "webhook in another workspace" }));
});
afterAll(async () => { await t.teardown(); });

describe("search (FR-3.8, T-207)", () => {
  it("ranks title + message matches above title-only ones, with a highlighted message snippet", async () => {
    const r = await search("webhook");
    expect(r.issues.map((x) => x.issue.key)).toEqual([keys.webhook, keys.title]);
    expect(r.issues[0]!.match).toMatchObject({ in: "title" });
    expect(r.issues[0]!.match.snippet).toContain(`${HL_START}webhook${HL_END}`);
    expect(r.issues[1]!.match).toMatchObject({ in: "title", snippet: null });
  });

  it("finds issues whose messages (not titles) match", async () => {
    const r = await search("timeout");
    expect(r.issues.map((x) => x.issue.key)).toEqual([keys.csv]);
    expect(r.issues[0]!.match.in).toBe("message");
    expect(r.issues[0]!.match.snippet).toContain(`${HL_START}timeout${HL_END}`);
  });

  it("supports phrases and negation (per title or message)", async () => {
    expect(await found('"signature mismatch"')).toEqual(["Our webhook signature mismatch started after the deploy"]);
    expect(await found('"mismatch signature"')).toEqual([]);
    expect(await found("webhook -redesign")).toEqual(["Our webhook signature mismatch started after the deploy"]);
  });

  it("from: finds messages by a contact (email or name) or a teammate", async () => {
    expect((await found("from:hank@globex.com")).sort()).toEqual(["Invoice shows the wrong VAT number", "Our webhook signature mismatch started after the deploy"]);
    expect(await found("from:scorpio vat")).toEqual(["Invoice shows the wrong VAT number"]);
    expect(await found("from:alice@acme.test")).toEqual(["CSV export times out for large reports"]);
    expect(await found("from:nobody@nowhere.test")).toEqual([]);
  });

  it("account:, status:, is:, channel:, priority: filter issues and combine", async () => {
    expect((await found("account:globex")).sort()).toEqual(["Invoice shows the wrong VAT number", "Our webhook signature mismatch started after the deploy"]);
    expect(await found("account:initech.io")).toEqual(["CSV export times out for large reports"]);
    expect(await found("account:globex status:resolved")).toEqual(["Invoice shows the wrong VAT number"]);
    expect((await found("account:globex is:open"))).toEqual(["Our webhook signature mismatch started after the deploy"]);
    expect(await found("is:mine")).toEqual(["CSV export times out for large reports"]);
    expect(await found("priority:urgent")).toEqual(["Webhook dashboard redesign"]);
    expect(await found("channel:ui")).toEqual(["Webhook dashboard redesign"]);
    expect((await found("is:unassigned channel:email")).sort()).toEqual(["Invoice shows the wrong VAT number", "Our webhook signature mismatch started after the deploy"]);
  });

  it("is:internal searches internal notes only", async () => {
    expect(await found("is:internal root cause")).toEqual(["CSV export times out for large reports"]);
    expect(await found("is:internal webhook")).toEqual([]);
  });

  it("keeps ignored issues out unless asked for", async () => {
    expect(await found("digest")).toEqual([]);
    expect(await found("digest status:ignored")).toEqual(["Automatic reply: webhook digest"]);
  });

  it("returns matching accounts by name or domain prefix", async () => {
    expect((await search("globex")).accounts).toEqual([expect.objectContaining({ name: "Globex Corporation", domains: ["globex.com"] })]);
    expect((await search("initech.i")).accounts.map((a) => a.name)).toEqual(["Initech"]);
  });

  it("is scoped to the workspace and safe with odd input", async () => {
    expect((await search("webhook", otherWs)).issues.map((r) => r.issue.title)).toEqual(["webhook in another workspace"]);
    for (const q of [`'; DROP TABLE issues; --`, `"unterminated`, `\\`, "(((", "a:b:c", "%_%"]) await search(q);
    expect((await search("   ")).issues).toEqual([]);
    expect((await t.app.inject({ url: `/v1/search?q=${"x".repeat(501)}`, headers: H() })).statusCode).toBe(422);
  });

  it("the cross-tenant search functions only ever see the caller's workspace (ADR-028)", async () => {
    const hits = (w: string | null) => (w
      ? withWorkspace(t.database.db, { workspaceId: w }, (tx) => tx.execute(sql`SELECT issue_id FROM search_message_hits('webhook', false, NULL, NULL, 100)`))
      : t.database.db.execute(sql`SELECT issue_id FROM search_message_hits('webhook', false, NULL, NULL, 100)`)).then((r) => r.rows.length);
    expect(await hits(null)).toBe(0); // no tenant context → nothing
    const mine = await hits(ws);
    const theirs = await hits(otherWs);
    expect(mine).toBe(2);
    expect(theirs).toBe(1);
    const titles = await t.database.db.execute(sql`SELECT issue_id FROM search_issue_title_hits('webhook', 100)`);
    expect(titles.rows).toEqual([]);
  });

  it("reports whether search runs with its full-text index", async () => {
    const { rows: [su] } = await t.owner.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    expect(await searchIndexAvailable(t.database.db)).toBe(su.rolsuper === true); // the test owner can create tickzy_system
  });
});

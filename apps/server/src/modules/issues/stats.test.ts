import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withWorkspace } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";
import { recordInboundMessage } from "../messages/inbound.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string;
let ws: string;
let otherWs: string;
const H = (w = ws) => auth(alice, w);
const stats = async (w = ws) => (await t.app.inject({ url: "/v1/issues/stats", headers: H(w) })).json();
const create = async (payload: Record<string, unknown>) => (await t.app.inject({ method: "POST", url: "/v1/issues", headers: H(), payload })).json();

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  const mk = async (slug: string) => (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: slug, slug, issue_prefix: "ACME" } })).json().id as string;
  ws = await mk("acme");
  otherWs = await mk("other");
  const me = (await t.app.inject({ url: "/v1/members", headers: H() })).json().data[0].id;
  const a = await create({ title: "triage" });
  const b = await create({ title: "mine", assignee_membership_id: me });
  await t.app.inject({ method: "POST", url: `/v1/issues/${b.key}/messages`, headers: H(), payload: { body: "on it", visibility: "public" } }); // → waiting_on_customer, first response
  const c = await create({ title: "done" });
  await t.app.inject({ method: "PATCH", url: `/v1/issues/${c.key}`, headers: H(), payload: { status: "resolved" } });
  const d = await create({ title: "noise" });
  await t.app.inject({ method: "PATCH", url: `/v1/issues/${d.key}`, headers: H(), payload: { status: "ignored" } });
  await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => recordInboundMessage(tx, ws, { channel: "email", threadKey: "<x@c>", externalId: "<m1@c>", sender: { kind: "email", key: "x@cust.io" }, body: "help" }));
  // One issue created yesterday (UTC), to check day boundaries.
  await t.owner.query("UPDATE issues SET created_at = date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '2 hours' WHERE title = 'triage'");
  void a;
});
afterAll(async () => { await t.teardown(); });

describe("issue stats (design v2 Overview, inbox tab counts)", () => {
  it("counts views from real data; ignored issues count nowhere", async () => {
    const s = await stats();
    expect(s.counts).toEqual({ open: 3, waiting_on_us: 2, waiting_on_customer: 1, mine: 1, unassigned: 2, done: 1 });
    expect(s.kpis).toMatchObject({ new_today: 3, new_yesterday: 1, waiting_on_us: 2, waiting_on_customer: 1, resolved_7d: 1, resolved_prev_7d: 0 });
    expect(s.kpis.avg_wait_seconds).toBeGreaterThanOrEqual(0);
    expect(s.kpis.median_first_response_seconds_7d).toBeGreaterThanOrEqual(0);
  });

  it("returns 14 UTC days of activity, today last", async () => {
    const s = await stats();
    expect(s.series).toHaveLength(14);
    expect(s.series.at(-1).day).toBe(new Date().toISOString().slice(0, 10));
    expect(s.series.at(-1)).toMatchObject({ created: 3, resolved: 1, first_responses: 1, customer_messages: 1, team_replies: 1 });
    expect(s.series.at(-2).created).toBe(1);
    expect(s.series.slice(0, 12).every((d: { created: number }) => d.created === 0)).toBe(true);
  });

  it("is per workspace; tokens get no 'mine' count", async () => {
    const other = await stats(otherWs);
    expect(other.counts).toEqual({ open: 0, waiting_on_us: 0, waiting_on_customer: 0, mine: 0, unassigned: 0, done: 0 });
    const tok = (await t.app.inject({ method: "POST", url: "/v1/api-tokens", headers: H(), payload: { name: "r", scopes: ["issues:read"], expires_in_days: null } })).json().token;
    const viaToken = (await t.app.inject({ url: "/v1/issues/stats", headers: { authorization: `Bearer ${tok}` } })).json();
    expect(viaToken.counts.mine).toBeNull();
    expect(viaToken.counts.open).toBe(3);
  });

  it("does not shadow the issue route", async () => {
    expect((await t.app.inject({ url: "/v1/issues/ACME-1", headers: H() })).statusCode).toBe(200);
  });
});

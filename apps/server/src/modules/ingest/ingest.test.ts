import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace, type Tx } from "@tickzy/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.ts";
import { auth, setupTestApp, testConfig } from "../../test-helpers.ts";
import { createPgBossQueue } from "../../jobs/queue.ts";
import { startWorker } from "../../worker.ts";
import { recordInboundMessage } from "../messages/inbound.ts";
import { createIngestRegistry, type InboundChannel, type InboundRequest, type StoredInboundEvent } from "./channel.ts";
import { processInboundEvent, purgeInboundEvents } from "./processor.ts";

/**
 * T-301 ingestion core (ADR-032, threat model §6.1), exercised with two fake channels that sign like Slack does
 * (HMAC-SHA256 over `v0:{timestamp}:{raw body}`): "slack" routes by provider tenant, "email" by endpoint address.
 * Real channels arrive with T-302 (email) and T-305 (Slack).
 */
const SECRET = "test-signing-secret";
const sign = (raw: string, ts: number, secret = SECRET) => `v0=${createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex")}`;
const processed: string[] = [];
/** Event ids whose processing throws, with how many times. */
const failTimes = new Map<string, number>();

function fakeChannel(kind: "slack" | "email"): InboundChannel {
  return {
    kind,
    maxBodyBytes: 4096,
    verify({ raw, headers, now }: InboundRequest) {
      const ts = Number(headers["x-tickzy-timestamp"]);
      const sig = String(headers["x-tickzy-signature"] ?? "");
      if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
      const want = Buffer.from(sign(raw.toString("utf8"), ts));
      const got = Buffer.from(sig);
      return got.length === want.length && timingSafeEqual(got, want);
    },
    parse({ raw }) {
      const p = JSON.parse(raw.toString("utf8")) as Record<string, string>;
      if (p.type === "url_verification") return { kind: "respond", status: 200, body: { challenge: p.challenge } };
      if (p.type === "ignored_type") return { kind: "ignore", reason: "not handled" };
      if (typeof p.event_id !== "string") throw new Error("no event id");
      return kind === "slack"
        ? { kind: "event", eventId: p.event_id, route: { by: "connection", externalTenantId: p.team! }, payload: p }
        : { kind: "event", eventId: p.event_id, route: { by: "endpoint", endpointKind: "email_address", externalId: p.to! }, payload: p };
    },
    async process(tx: Tx, ev: StoredInboundEvent) {
      const p = ev.payload as Record<string, string>;
      const left = failTimes.get(ev.providerEventId) ?? 0;
      if (left > 0) { failTimes.set(ev.providerEventId, left - 1); throw new Error("provider hiccup"); }
      if (p.kind === "noise") return "ignored";
      await recordInboundMessage(tx, ev.workspaceId, {
        channel: kind, threadKey: p.thread ?? p.event_id!, endpointId: ev.endpointId, externalId: p.event_id!,
        sender: { kind: "email", key: p.from ?? "hank@globex.com", name: "Hank" }, body: p.text ?? "Hello",
      });
      processed.push(ev.providerEventId);
      return "processed";
    },
  };
}

let t: Awaited<ReturnType<typeof setupTestApp>>;
let app: FastifyInstance;
let alice: string; let wsA: string; let wsB: string;
let connA: string; let endpointB: string;
const registry = createIngestRegistry([fakeChannel("slack"), fakeChannel("email")]);
let clock = Date.now();
const send = (channel: string, body: unknown, opts: { ts?: number; secret?: string; raw?: string; target?: FastifyInstance } = {}) => {
  const raw = opts.raw ?? JSON.stringify(body);
  const ts = opts.ts ?? Math.floor(clock / 1000);
  return (opts.target ?? app).inject({
    method: "POST", url: `/ingest/${channel}`, payload: raw,
    headers: { "content-type": "application/json", "x-tickzy-timestamp": String(ts), "x-tickzy-signature": sign(raw, ts, opts.secret) },
  });
};
const countAll = async (table: string) => Number((await t.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const eventRow = (ws: string, providerId: string) => withWorkspace(t.database.db, { workspaceId: ws }, async (tx) =>
  (await tx.select().from(schema.inboundEvents).where(eq(schema.inboundEvents.providerEventId, providerId)))[0]);

beforeAll(async () => {
  t = await setupTestApp();
  app = await buildApp({ config: { ...testConfig, INGEST_PER_WORKSPACE_PER_MIN: 5 }, database: t.database, email: t.email, ingest: registry, now: () => clock });
  alice = await t.createUser("alice@example.com");
  const mk = async (slug: string, prefix: string) => (await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: slug, slug, issue_prefix: prefix } })).json().id as string;
  wsA = await mk("acme", "ACME");
  wsB = await mk("beta", "BETA");
  connA = newId("channelConnection");
  await withWorkspace(t.database.db, { workspaceId: wsA }, (tx) => tx.insert(schema.channelConnections).values({ id: connA, workspaceId: wsA, kind: "slack", externalTenantId: "T_ACME" }));
  const connB = newId("channelConnection");
  endpointB = newId("channelEndpoint");
  await withWorkspace(t.database.db, { workspaceId: wsB }, async (tx) => {
    await tx.insert(schema.channelConnections).values({ id: connB, workspaceId: wsB, kind: "email" });
    await tx.insert(schema.channelEndpoints).values({ id: endpointB, workspaceId: wsB, connectionId: connB, kind: "email_address", externalId: "support@beta.inbound.test", name: "Support" });
  });
});
afterAll(async () => { await app.close(); await t.teardown(); });

describe("ingest webhook (T-301)", () => {
  it("checks the signature on the raw body BEFORE parsing: bad or missing signature → 401 even for garbage", async () => {
    expect((await send("slack", null, { raw: "{not json", secret: "wrong" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/ingest/slack", payload: "{}", headers: { "content-type": "application/json" } })).statusCode).toBe(401);
    expect((await send("slack", null, { raw: "{not json" })).statusCode).toBe(422); // signed garbage → only now a parse error
    const stale = await send("slack", { event_id: "Ev_old", team: "T_ACME" }, { ts: Math.floor(clock / 1000) - 301 });
    expect(stale.statusCode).toBe(401); // replay window: 5 minutes
    expect(stale.json().error.code).toBe("unauthenticated");
  });

  it("answers provider handshakes and acknowledges ignored event types without storing them", async () => {
    expect((await send("slack", { type: "url_verification", challenge: "abc" })).json()).toEqual({ challenge: "abc" });
    expect((await send("slack", { type: "ignored_type" })).json()).toEqual({ ok: true });
    expect(await countAll("inbound_events")).toBe(0);
  });

  it("routes by the server-side mapping, persists before acknowledging, and emits an outbox event", async () => {
    const res = await send("slack", { event_id: "Ev1", team: "T_ACME", text: "Webhooks are failing" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, duplicate: false });
    const row = await eventRow(wsA, "Ev1"); // already stored when the response arrived
    expect(row).toMatchObject({ workspaceId: wsA, channel: "slack", connectionId: connA, status: "received", attempts: 0 });
    const outbox = await withWorkspace(t.database.db, { workspaceId: wsA }, (tx) => tx.select().from(schema.outbox).where(eq(schema.outbox.type, "inbound.received")));
    expect(outbox.map((o) => o.payload)).toContainEqual({ inbound_event_id: row!.id, channel: "slack" });
    expect(await eventRow(wsB, "Ev1")).toBeUndefined();
  });

  it("deduplicates provider retries on the event id", async () => {
    const again = await send("slack", { event_id: "Ev1", team: "T_ACME", text: "Webhooks are failing" });
    expect(again.json()).toEqual({ ok: true, duplicate: true });
    expect(Number((await t.owner.query("SELECT count(*)::int AS n FROM inbound_events WHERE provider_event_id = 'Ev1'")).rows[0].n)).toBe(1);
    expect(Number((await t.owner.query("SELECT count(*)::int AS n FROM outbox WHERE type = 'inbound.received'")).rows[0].n)).toBe(1);
  });

  it("acknowledges events no workspace claims but keeps nothing (payload tenant ids are not trusted)", async () => {
    const before = await countAll("inbound_events");
    expect((await send("slack", { event_id: "Ev_x", team: "T_UNKNOWN" })).json()).toEqual({ ok: true });
    expect((await send("email", { event_id: "Ev_y", to: "nobody@nowhere.test" })).json()).toEqual({ ok: true });
    expect(await countAll("inbound_events")).toBe(before);
  });

  it("routes by endpoint address; disabled endpoints stop receiving", async () => {
    await send("email", { event_id: "<m1@globex.com>", to: "support@beta.inbound.test", text: "Invoice question" });
    expect(await eventRow(wsB, "<m1@globex.com>")).toMatchObject({ endpointId: endpointB, channel: "email" });
    await withWorkspace(t.database.db, { workspaceId: wsB }, (tx) => tx.update(schema.channelEndpoints).set({ status: "disabled" }).where(eq(schema.channelEndpoints.id, endpointB)));
    await send("email", { event_id: "<m2@globex.com>", to: "support@beta.inbound.test" });
    expect(await eventRow(wsB, "<m2@globex.com>")).toBeUndefined();
    await withWorkspace(t.database.db, { workspaceId: wsB }, (tx) => tx.update(schema.channelEndpoints).set({ status: "active" }).where(eq(schema.channelEndpoints.id, endpointB)));
  });

  it("refuses oversized bodies and applies a per-workspace budget", async () => {
    const big = await send("slack", { event_id: "Ev_big", team: "T_ACME", text: "x".repeat(5000) });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe("payload_too_large");
    clock += 120_000; // fresh budget window
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await send("slack", { event_id: `Ev_budget_${i}`, team: "T_ACME" })).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    const limited = await send("slack", { event_id: "Ev_budget_9", team: "T_ACME" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect((await send("email", { event_id: "<m3@globex.com>", to: "support@beta.inbound.test" })).statusCode).toBe(200); // other workspace unaffected
    clock += 120_000;
  });
});

describe("processing (worker side)", () => {
  it("turns a stored event into an issue, once", async () => {
    const ev = (await eventRow(wsA, "Ev1"))!;
    await processInboundEvent(t.database.db, registry, { workspaceId: wsA, inboundEventId: ev.id, finalAttempt: false }, () => undefined);
    expect(await eventRow(wsA, "Ev1")).toMatchObject({ status: "processed", attempts: 1, lastError: null });
    await processInboundEvent(t.database.db, registry, { workspaceId: wsA, inboundEventId: ev.id, finalAttempt: false }, () => undefined);
    expect(processed.filter((id) => id === "Ev1")).toHaveLength(1);
    const issues = (await app.inject({ url: "/v1/issues?status=triage", headers: auth(alice, wsA) })).json().data;
    expect(issues.map((i: { title: string }) => i.title)).toContain("Webhooks are failing");
  });

  it("records failures without the payload, retries, and marks the event failed on the last attempt", async () => {
    await send("slack", { event_id: "Ev_fail", team: "T_ACME", text: "Will fail" });
    const ev = (await eventRow(wsA, "Ev_fail"))!;
    failTimes.set("Ev_fail", 2);
    await expect(processInboundEvent(t.database.db, registry, { workspaceId: wsA, inboundEventId: ev.id, finalAttempt: false }, () => undefined)).rejects.toThrow("provider hiccup");
    expect(await eventRow(wsA, "Ev_fail")).toMatchObject({ status: "received", attempts: 1, lastError: "provider hiccup" });
    await processInboundEvent(t.database.db, registry, { workspaceId: wsA, inboundEventId: ev.id, finalAttempt: true }, () => undefined);
    expect(await eventRow(wsA, "Ev_fail")).toMatchObject({ status: "failed", attempts: 2 });
    const issues = (await app.inject({ url: "/v1/issues?q=Will%20fail", headers: auth(alice, wsA) })).json().data;
    expect(issues).toHaveLength(0); // the failed attempts left nothing behind (savepoint rolled back)
  });

  it("processes a workspace's events in arrival order even when a later event's job runs first", async () => {
    await send("slack", { event_id: "Ev_order_1", team: "T_ACME", text: "first" });
    await send("slack", { event_id: "Ev_order_2", team: "T_ACME", text: "second" });
    const second = (await eventRow(wsA, "Ev_order_2"))!;
    const mark = processed.length;
    await processInboundEvent(t.database.db, registry, { workspaceId: wsA, inboundEventId: second.id, finalAttempt: false }, () => undefined);
    const order = processed.slice(mark).filter((id) => id.startsWith("Ev_order_"));
    expect(order).toEqual(["Ev_order_1", "Ev_order_2"]);
    expect((await eventRow(wsA, "Ev_order_1"))!.status).toBe("processed");
    const first = (await eventRow(wsA, "Ev_order_1"))!;
    await processInboundEvent(t.database.db, registry, { workspaceId: wsA, inboundEventId: first.id, finalAttempt: false }, () => undefined); // its own job: no-op
    expect(processed.filter((id) => id === "Ev_order_1")).toHaveLength(1);
  });

  it("end to end through the real worker: webhook → outbox → queue → channel → issue", async () => {
    const queue = createPgBossQueue(t.appUrl);
    const worker = await startWorker({ database: t.database, queue, channels: (await import("../messages/delivery.ts")).createDeliveryRegistry(), ingest: registry, log: () => undefined, pollMs: 200 });
    try {
      await send("email", { event_id: "<e2e@globex.com>", to: "support@beta.inbound.test", text: "Through the real worker" });
      const deadline = Date.now() + 20_000;
      let status = "received";
      while (Date.now() < deadline && status !== "processed") {
        await new Promise((r) => setTimeout(r, 250));
        status = (await eventRow(wsB, "<e2e@globex.com>"))?.status ?? "missing";
      }
      expect(status).toBe("processed");
      const issues = (await app.inject({ url: "/v1/issues?q=real%20worker", headers: auth(alice, wsB) })).json().data;
      expect(issues).toHaveLength(1);
    } finally {
      await worker.stop();
    }
  }, 30_000);

  it("retention removes handled events older than the cut-off, never unprocessed ones", async () => {
    await send("slack", { event_id: "Ev_pending", team: "T_ACME" }); // no worker running now: stays "received"
    await t.owner.query("UPDATE inbound_events SET received_at = now() - interval '40 days' WHERE provider_event_id IN ('Ev1', 'Ev_pending')");
    const ev1 = (await eventRow(wsA, "Ev1"))!; // processed
    expect((await eventRow(wsA, "Ev_pending"))!.status).toBe("received");
    expect(await purgeInboundEvents(t.database.db, 30)).toBe(1);
    expect(await eventRow(wsA, "Ev1")).toBeUndefined();
    expect(await eventRow(wsA, "Ev_pending")).toBeDefined();
    expect(ev1.id).toMatch(/^ine_/);
  });
});

describe("tenancy and process roles", () => {
  it("isolates connections, endpoints and events per workspace; cross-tenant references are refused", async () => {
    const seen = await withWorkspace(t.database.db, { workspaceId: wsB }, async (tx) => ({
      connections: await tx.select().from(schema.channelConnections),
      events: await tx.select().from(schema.inboundEvents).where(eq(schema.inboundEvents.workspaceId, wsA)),
    }));
    expect(seen.connections.every((c) => c.workspaceId === wsB)).toBe(true);
    expect(seen.events).toHaveLength(0);
    // An endpoint in B pointing at A's connection: the composite foreign key refuses it even with a known id.
    await expect(withWorkspace(t.database.db, { workspaceId: wsB }, (tx) => tx.insert(schema.channelEndpoints).values({
      id: newId("channelEndpoint"), workspaceId: wsB, connectionId: connA, kind: "slack_channel", externalId: "C1", name: "x" }))).rejects.toThrow();
    // A conversation in A pointing at B's endpoint: refused too (the FK 0008 deferred to this task).
    await expect(withWorkspace(t.database.db, { workspaceId: wsA }, (tx) => tx.insert(schema.conversations).values({
      id: newId("conversation"), workspaceId: wsA, channelKind: "email", endpointId: endpointB, externalThreadKey: "x" }))).rejects.toThrow();
    // The app role cannot delete raw events (retention goes through purge_inbound_events only).
    const denied = await withWorkspace(t.database.db, { workspaceId: wsA }, (tx) => tx.delete(schema.inboundEvents)).then(() => null, (e: { cause?: { message?: string } }) => e);
    expect(denied?.cause?.message).toMatch(/permission denied/);
  });

  it("a Slack team can be connected to one workspace only (unambiguous routing)", async () => {
    await expect(withWorkspace(t.database.db, { workspaceId: wsB }, (tx) => tx.insert(schema.channelConnections).values({
      id: newId("channelConnection"), workspaceId: wsB, kind: "slack", externalTenantId: "T_ACME" }))).rejects.toThrow();
  });

  it("process roles: an ingest-only process serves no API; an API-only process serves no webhooks", async () => {
    const ingestOnly = await buildApp({ config: testConfig, database: t.database, email: t.email, ingest: registry, surfaces: { api: false, ingest: true } });
    const apiOnly = await buildApp({ config: testConfig, database: t.database, email: t.email, ingest: registry, surfaces: { api: true, ingest: false } });
    try {
      expect((await ingestOnly.inject({ url: "/v1/issues", headers: auth(alice, wsA) })).statusCode).toBe(404);
      expect((await send("slack", { type: "url_verification", challenge: "z" }, { target: ingestOnly })).statusCode).toBe(200);
      expect((await ingestOnly.inject({ url: "/healthz" })).statusCode).toBe(200);
      expect((await send("slack", { type: "url_verification", challenge: "z" }, { target: apiOnly })).statusCode).toBe(404);
    } finally {
      await ingestOnly.close();
      await apiOnly.close();
    }
  });
});

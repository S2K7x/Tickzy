import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace } from "@tickzy/db";
import { buildApp } from "../../app.ts";
import { auth, setupTestApp, testConfig } from "../../test-helpers.ts";
import { createPgBossQueue, QUEUE_RETRY_LIMIT } from "../../jobs/queue.ts";
import { startWorker } from "../../worker.ts";
import { createDeliveryRegistry, type ChannelAdapter, type OutboundMessage } from "./delivery.ts";
import { deliverPendingMessage } from "./service.ts";

/** A fake email channel: records deliveries; can be told to fail. */
class FakeEmail implements ChannelAdapter {
  readonly kind = "email" as const;
  sent: OutboundMessage[] = [];
  failing = false;
  async deliver(m: OutboundMessage) {
    if (this.failing) throw new Error("smtp down");
    this.sent.push(m);
    return { externalId: `<${m.messageId}@mail.test>` };
  }
}

let t: Awaited<ReturnType<typeof setupTestApp>>;
let app: FastifyInstance; // app with the fake email channel registered
const email = new FakeEmail();
const channels = createDeliveryRegistry([email]);
let alice: string; let carl: string; let vera: string;
let ws: string; let otherWs: string;
let emailIssue: string; // issue whose conversation is an email thread

const H = (u = alice, w = ws) => auth(u, w);
const post = (ref: string, payload: Record<string, unknown>, u = alice, a = app) => a.inject({ method: "POST", url: `/v1/issues/${ref}/messages`, headers: H(u), payload });
const messageRow = (id: string) => withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => (await tx.select().from(schema.messages).where(eq(schema.messages.id, id)))[0]!);

beforeAll(async () => {
  t = await setupTestApp();
  app = await buildApp({ config: testConfig, database: t.database, email: t.email, channels });
  alice = await t.createUser("alice@example.com");
  carl = await t.createUser("carl@example.com");
  vera = await t.createUser("vera@example.com");
  const mk = async (slug: string) => (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: slug, slug, issue_prefix: "ACME" } })).json().id as string;
  ws = await mk("acme");
  otherWs = await mk("other");
  await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
    await tx.insert(schema.memberships).values([
      { id: newId("membership"), workspaceId: ws, userId: carl, role: "collaborator" },
      { id: newId("membership"), workspaceId: ws, userId: vera, role: "viewer" },
    ]);
  });
  // ACME-1: created in the app (ui channel). ACME-2: arrived by email (a thread with an inbound message).
  await app.inject({ method: "POST", url: "/v1/issues", headers: H(), payload: { title: "UI issue" } });
  emailIssue = (await app.inject({ method: "POST", url: "/v1/issues", headers: H(), payload: { title: "Email issue" } })).json().id;
  await withWorkspace(t.database.db, { workspaceId: ws }, async (tx) => {
    const cnv = newId("conversation");
    await tx.insert(schema.conversations).values({ id: cnv, workspaceId: ws, channelKind: "email", externalThreadKey: "<root@customer.test>" });
    await tx.insert(schema.messages).values({ id: newId("message"), workspaceId: ws, conversationId: cnv, issueId: emailIssue, direction: "in", visibility: "public", authorType: "contact", source: "email", deliveryState: "received", bodyText: "Our exports fail" });
  });
});
afterAll(async () => { await app.close(); await t.teardown(); });

describe("posting messages (T-205)", () => {
  it("a reply on an app-created issue has nothing to deliver; it is on the timeline with its author", async () => {
    const res = await post("ACME-1", { body: "Thanks — looking into it", visibility: "public" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ visibility: "public", direction: "out", source: "ui", delivery_state: null, author: { type: "member", id: alice, name: "alice@example.com" }, body: { text: "Thanks — looking into it" } });
    const tl = (await app.inject({ url: "/v1/issues/ACME-1/timeline", headers: H() })).json().data;
    expect(tl.filter((i: { kind: string }) => i.kind === "message")).toHaveLength(1);
  });

  it("a public reply on an email issue joins the customer's thread and is queued for delivery", async () => {
    const m = (await post("ACME-2", { body: "Fixed in 2.4.1", visibility: "public" })).json();
    expect(m.delivery_state).toBe("pending");
    const row = await messageRow(m.id);
    const [cnv] = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.conversations).where(eq(schema.conversations.id, row.conversationId)));
    expect(cnv).toMatchObject({ channelKind: "email", externalThreadKey: "<root@customer.test>" });
    const events = await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.outbox));
    expect(events.filter((e) => e.type === "message.created").map((e) => e.payload)).toContainEqual({ message_id: m.id, issue_id: emailIssue, visibility: "public", deliver: true });
  });

  it("internal notes are never queued, even on a deliverable channel", async () => {
    const n = (await post("ACME-2", { body: "Customer is on the legacy plan", visibility: "internal" })).json();
    expect(n).toMatchObject({ visibility: "internal", delivery_state: null });
    // Even if a job for it were somehow enqueued, the worker refuses it and the adapter is never called.
    const logs: string[] = [];
    const before = email.sent.length;
    expect(await deliverPendingMessage(t.database.db, channels, { workspaceId: ws, messageId: n.id, retryCount: 0 }, (msg) => logs.push(msg))).toBe("skipped");
    expect(email.sent.length).toBe(before);
    expect(logs[0]).toContain("refused to deliver internal note");
  });

  it("permissions follow visibility: collaborators and viewers add notes but cannot reply; tokens need the matching scope", async () => {
    expect((await post("ACME-1", { body: "note", visibility: "internal" }, carl)).statusCode).toBe(201);
    expect((await post("ACME-1", { body: "note", visibility: "internal" }, vera)).statusCode).toBe(201);
    expect((await post("ACME-1", { body: "reply", visibility: "public" }, carl)).statusCode).toBe(403);
    const noteTok = (await app.inject({ method: "POST", url: "/v1/api-tokens", headers: H(), payload: { name: "notes", scopes: ["issues:note"], expires_in_days: null } })).json().token;
    const bearer = { authorization: `Bearer ${noteTok}` };
    expect((await app.inject({ method: "POST", url: "/v1/issues/ACME-1/messages", headers: bearer, payload: { body: "x", visibility: "public" } })).statusCode).toBe(403);
    const viaToken = (await app.inject({ method: "POST", url: "/v1/issues/ACME-1/messages", headers: bearer, payload: { body: "from CI", visibility: "internal" } })).json();
    expect(viaToken).toMatchObject({ source: "api", author: { type: "system", name: "API: notes" } });
  });

  it("validates input and scopes to the workspace", async () => {
    expect((await post("ACME-1", { body: "   ", visibility: "public" })).statusCode).toBe(422);
    expect((await post("ACME-1", { body: "x", visibility: "secret" })).statusCode).toBe(422);
    expect((await post("ACME-404", { body: "x", visibility: "public" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/issues/${emailIssue}/messages`, headers: H(alice, otherWs), payload: { body: "x", visibility: "public" } })).statusCode).toBe(404);
  });
});

describe("delivery worker (T-205)", () => {
  it("delivers once into the customer's thread and is idempotent", async () => {
    const m = (await post("ACME-2", { body: "Second reply", visibility: "public" })).json();
    expect(await deliverPendingMessage(t.database.db, channels, { workspaceId: ws, messageId: m.id, retryCount: 0 })).toBe("sent");
    expect(email.sent.at(-1)).toMatchObject({ messageId: m.id, externalThreadKey: "<root@customer.test>", bodyText: "Second reply" });
    expect(await messageRow(m.id)).toMatchObject({ deliveryState: "sent", externalId: `<${m.id}@mail.test>` });
    const count = email.sent.length;
    expect(await deliverPendingMessage(t.database.db, channels, { workspaceId: ws, messageId: m.id, retryCount: 0 })).toBe("skipped");
    expect(email.sent.length).toBe(count);
  });

  it("retries on errors, marks the message failed on the last attempt, and can be retried by an agent", async () => {
    const m = (await post("ACME-2", { body: "Will fail", visibility: "public" })).json();
    email.failing = true;
    await expect(deliverPendingMessage(t.database.db, channels, { workspaceId: ws, messageId: m.id, retryCount: 0 })).rejects.toThrow("smtp down");
    expect((await messageRow(m.id)).deliveryState).toBe("pending");
    expect(await deliverPendingMessage(t.database.db, channels, { workspaceId: ws, messageId: m.id, retryCount: QUEUE_RETRY_LIMIT })).toBe("failed");
    expect((await messageRow(m.id)).deliveryState).toBe("failed");
    const types = (await withWorkspace(t.database.db, { workspaceId: ws }, (tx) => tx.select().from(schema.outbox))).map((e) => e.type);
    expect(types).toContain("message.delivery_failed");

    email.failing = false;
    const retried = await app.inject({ method: "POST", url: `/v1/messages/${m.id}/retry`, headers: H() });
    expect(retried.json().delivery_state).toBe("pending");
    expect((await app.inject({ method: "POST", url: `/v1/messages/${m.id}/retry`, headers: H() })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/v1/messages/${m.id}/retry`, headers: H(carl) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/messages/${m.id}/retry`, headers: H(alice, otherWs) })).statusCode).toBe(404);
    expect(await deliverPendingMessage(t.database.db, channels, { workspaceId: ws, messageId: m.id, retryCount: 0 })).toBe("sent");
  });

  it("end to end: API → outbox → relay → queue → adapter → sent", async () => {
    const queue = createPgBossQueue(t.appUrl);
    const worker = await startWorker({ database: t.database, queue, channels, log: () => undefined, pollMs: 200 });
    try {
      const m = (await post("ACME-2", { body: "Through the real worker", visibility: "public" })).json();
      const deadline = Date.now() + 20_000;
      let state = "pending";
      while (Date.now() < deadline && state !== "sent") {
        await new Promise((r) => setTimeout(r, 250));
        state = (await messageRow(m.id)).deliveryState ?? "null";
      }
      expect(state).toBe("sent");
      expect(email.sent.filter((s) => s.messageId === m.id)).toHaveLength(1);
    } finally {
      await worker.stop();
    }
  }, 30_000);
});

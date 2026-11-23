import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace, type Tx } from "@tickzy/db";
import { auth, setupTestApp } from "../../test-helpers.ts";
import type { Actor } from "../../http/auth.ts";
import { changeStatus, createIssue, issueKey } from "./domain.ts";

let t: Awaited<ReturnType<typeof setupTestApp>>;
let alice: string;
let ws: string;
let otherWs: string;
let actor: Actor;

const inWs = <T>(w: string, fn: (tx: Tx) => Promise<T>) => withWorkspace(t.database.db, { workspaceId: w }, fn);
async function expectPgError(promise: Promise<unknown>, pattern: RegExp) {
  const err = await promise.then(() => { throw new Error("expected failure"); }, (e: unknown) => e as Error & { cause?: Error });
  expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(pattern);
}

beforeAll(async () => {
  t = await setupTestApp();
  alice = await t.createUser("alice@example.com");
  const mk = async (slug: string) => (await t.app.inject({ method: "POST", url: "/v1/workspaces", headers: auth(alice), payload: { name: slug, slug, issue_prefix: "ACME" } })).json().id as string;
  ws = await mk("acme");
  otherWs = await mk("other");
  actor = { type: "user", id: alice };
});
afterAll(async () => { await t.teardown(); });

describe("issue creation & numbering (T-202)", () => {
  it("creates an issue in Triage with the default status, a timeline event and an outbox event", async () => {
    const issue = await inWs(ws, (tx) => createIssue(tx, ws, actor, { title: "Webhook retries failing", channelKind: "api" }));
    expect(issue).toMatchObject({ number: 1, statusCategory: "triage", priority: "normal", version: 1 });
    expect(issueKey("ACME", issue.number)).toBe("ACME-1");
    await inWs(ws, async (tx) => {
      const [st] = await tx.select().from(schema.statuses).where(eq(schema.statuses.id, issue.statusId));
      expect(st).toMatchObject({ category: "triage", isDefault: true });
      const events = await tx.select().from(schema.issueEvents).where(eq(schema.issueEvents.issueId, issue.id));
      expect(events.map((e) => [e.type, e.actorType, e.actorId])).toEqual([["issue.created", "user", alice]]);
      expect((await tx.select().from(schema.outbox)).map((o) => o.type)).toContain("issue.created");
    });
  });

  it("allocates unique, gap-free numbers under concurrency", async () => {
    const created = await Promise.all(Array.from({ length: 25 }, (_, i) =>
      inWs(ws, (tx) => createIssue(tx, ws, actor, { title: `Concurrent ${i}`, channelKind: "api" }))));
    expect(created.map((c) => c.number).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 2));
  });

  it("a rolled-back creation does not burn a number; workspaces number independently", async () => {
    await expect(inWs(ws, async (tx) => {
      await createIssue(tx, ws, actor, { title: "will roll back", channelKind: "api" });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    const next = await inWs(ws, (tx) => createIssue(tx, ws, actor, { title: "after rollback", channelKind: "api" }));
    expect(next.number).toBe(27);
    const first = await inWs(otherWs, (tx) => createIssue(tx, otherWs, actor, { title: "other ws", channelKind: "ui" }));
    expect(first.number).toBe(1);
  });
});

describe("status integrity and manual changes (FR-3.1)", () => {
  it("the database rejects a status from another category or another workspace", async () => {
    const [triage] = await inWs(ws, (tx) => tx.select().from(schema.statuses).where(eq(schema.statuses.category, "triage")));
    const [foreign] = await inWs(otherWs, (tx) => tx.select().from(schema.statuses).where(eq(schema.statuses.category, "resolved")));
    await expectPgError(inWs(ws, (tx) => tx.insert(schema.issues).values({ id: newId("issue"), workspaceId: ws, number: 900, title: "x", statusCategory: "resolved", statusId: triage!.id, channelKind: "api" })), /foreign key/);
    await expectPgError(inWs(ws, (tx) => tx.insert(schema.issues).values({ id: newId("issue"), workspaceId: ws, number: 901, title: "x", statusCategory: "resolved", statusId: foreign!.id, channelKind: "api" })), /foreign key/);
  });

  it("resolving stamps resolved_at, reopening clears it, custom statuses carry their category, events record from/to", async () => {
    const issue = await inWs(ws, (tx) => createIssue(tx, ws, actor, { title: "lifecycle", channelKind: "api" }));
    const resolved = await inWs(ws, (tx) => changeStatus(tx, ws, actor, issue.id, { category: "resolved" }));
    expect(resolved.statusCategory).toBe("resolved");
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect(resolved.version).toBe(2);
    const custom = newId("status");
    await inWs(ws, (tx) => tx.insert(schema.statuses).values({ id: custom, workspaceId: ws, category: "waiting_on_us", name: "Investigating", position: 2 }));
    const reopened = await inWs(ws, (tx) => changeStatus(tx, ws, actor, issue.id, { statusId: custom }));
    expect(reopened).toMatchObject({ statusId: custom, statusCategory: "waiting_on_us", resolvedAt: null, version: 3 });
    const events = await inWs(ws, (tx) => tx.select().from(schema.issueEvents).where(eq(schema.issueEvents.issueId, issue.id)));
    expect(events.map((e) => e.type)).toEqual(["issue.created", "issue.status_changed", "issue.status_changed"]);
    expect(events[2]!.data).toMatchObject({ from: { category: "resolved" }, to: { category: "waiting_on_us", status_id: custom } });
  });

  it("closed is terminal, stale versions conflict, unknown statuses are rejected", async () => {
    const issue = await inWs(ws, (tx) => createIssue(tx, ws, actor, { title: "terminal", channelKind: "api" }));
    await expect(inWs(ws, (tx) => changeStatus(tx, ws, actor, issue.id, { category: "blocked" }, { expectedVersion: 99 }))).rejects.toMatchObject({ code: "conflict" });
    await inWs(ws, (tx) => changeStatus(tx, ws, actor, issue.id, { category: "closed" }, { expectedVersion: 1 }));
    await expect(inWs(ws, (tx) => changeStatus(tx, ws, actor, issue.id, { category: "waiting_on_us" }))).rejects.toMatchObject({ code: "conflict" });
    await expect(inWs(ws, (tx) => changeStatus(tx, ws, actor, issue.id, { statusId: newId("status") }))).rejects.toMatchObject({ code: "validation_failed" });
    const [foreign] = await inWs(otherWs, (tx) => tx.select().from(schema.statuses).limit(1));
    await expect(inWs(ws, (tx) => changeStatus(tx, ws, actor, issue.id, { statusId: foreign!.id }))).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("the timeline is append-only", async () => {
    await expectPgError(inWs(ws, (tx) => tx.execute(sql`UPDATE issue_events SET type = 'x'`)), /permission denied/);
    await expectPgError(inWs(ws, (tx) => tx.execute(sql`DELETE FROM issue_events`)), /permission denied/);
  });
});

describe("messages (FR-3.5) and isolation", () => {
  let conversation: string;
  let issueId: string;
  beforeAll(async () => {
    conversation = newId("conversation");
    const issue = await inWs(ws, async (tx) => {
      await tx.insert(schema.conversations).values({ id: conversation, workspaceId: ws, channelKind: "api" });
      return createIssue(tx, ws, actor, { title: "messages", channelKind: "api" });
    });
    issueId = issue.id;
  });
  const msg = (over: Partial<typeof schema.messages.$inferInsert>) =>
    inWs(ws, (tx) => tx.insert(schema.messages).values({
      id: newId("message"), workspaceId: ws, conversationId: conversation, issueId, direction: "out", visibility: "public",
      authorType: "member", authorId: alice, bodyText: "hello", source: "ui", ...over,
    }));

  it("internal notes can never enter delivery", async () => {
    await msg({ visibility: "internal", bodyText: "internal only" });
    for (const state of ["pending", "sent", "failed"] as const) {
      await expectPgError(msg({ visibility: "internal", deliveryState: state }), /check constraint/);
    }
  });

  it("inbound messages come from contacts, are public and received; team messages are outbound", async () => {
    await msg({ direction: "in", authorType: "contact", deliveryState: "received", source: "email", externalId: "<m1@x>" });
    await expectPgError(msg({ direction: "in", authorType: "member", deliveryState: "received" }), /check constraint/);
    await expectPgError(msg({ direction: "in", authorType: "contact", visibility: "internal", deliveryState: "received" }), /check constraint/);
    await expectPgError(msg({ direction: "out", authorType: "contact" }), /check constraint/);
  });

  it("deduplicates inbound provider message ids", async () => {
    await expectPgError(msg({ direction: "in", authorType: "contact", deliveryState: "received", source: "email", externalId: "<m1@x>" }), /duplicate key/);
  });

  it("maintains a full-text search vector", async () => {
    await msg({ bodyText: "The webhook signature verification fails intermittently" });
    const rows = await inWs(ws, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM messages WHERE search @@ plainto_tsquery('simple', 'signature verification')`));
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("other workspaces see nothing and cannot attach to these records", async () => {
    for (const table of [schema.issues, schema.messages, schema.conversations, schema.issueEvents]) {
      const mine = await inWs(otherWs, (tx) => tx.select().from(table));
      expect(mine.every((r) => r.workspaceId === otherWs)).toBe(true);
    }
    await expectPgError(inWs(otherWs, (tx) => tx.insert(schema.messages).values({
      id: newId("message"), workspaceId: otherWs, conversationId: conversation, direction: "out", visibility: "public", authorType: "system", source: "api",
    })), /foreign key/);
    await expectPgError(inWs(otherWs, (tx) => tx.insert(schema.issueEvents).values({ workspaceId: otherWs, issueId, type: "issue.hijack", actorType: "system" })), /foreign key/);
  });
});

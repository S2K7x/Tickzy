import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newId } from "@tickzy/shared";
import { schema, withWorkspace, type Database } from "@tickzy/db";
import { resetTestDatabase } from "@tickzy/db/testing";
import type pg from "pg";
import { createPgBossQueue, type JobQueue, type SendOptions } from "./queue.ts";
import { jobIdFor, OutboxRelay, Subscriptions } from "./relay.ts";

let database: Database;
let owner: pg.Client;
let appUrl: string;
let queue: JobQueue;
const wsA = newId("workspace");
const wsB = newId("workspace");

async function seedWorkspace(ws: string, slug: string) {
  await withWorkspace(database.db, { workspaceId: ws }, (tx) =>
    tx.insert(schema.workspaces).values({ id: ws, name: slug, slug, issuePrefix: "TKZ" }),
  );
}
async function emit(ws: string, type: string, payload: Record<string, unknown> = {}) {
  await withWorkspace(database.db, { workspaceId: ws }, (tx) => tx.insert(schema.outbox).values({ workspaceId: ws, type, payload }));
}
async function jobs(queueName: string) {
  const { rows } = await owner.query("SELECT id, data FROM pgboss.job WHERE name = $1 ORDER BY created_on", [queueName]);
  return rows as { id: string; data: { event_id: number; workspace_id: string; type: string; created_at: string } }[];
}
async function unpublished() {
  const { rows } = await owner.query("SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL");
  return rows[0].n as number;
}

beforeAll(async () => {
  ({ app: database, owner, appUrl } = await resetTestDatabase());
  queue = createPgBossQueue(appUrl);
  await queue.start(); // pg-boss installs its tables into the pgboss schema owned by the app role
  await seedWorkspace(wsA, "relay-a");
  await seedWorkspace(wsB, "relay-b");
});
afterAll(async () => {
  await queue.stop();
  await database.close();
  await owner.end();
});
beforeEach(async () => {
  await owner.query("DELETE FROM outbox");
  await owner.query("DELETE FROM pgboss.job");
});

describe("outbox relay (T-009)", () => {
  const subs = new Subscriptions().subscribe("issue.created", "sla.recompute").subscribe("issue.created", "ai.triage").subscribe("*", "webhooks.deliver");

  it("fans each event out to every subscribed queue, across tenants, and marks it published", async () => {
    await emit(wsA, "issue.created", { issue_id: "iss_x" });
    await emit(wsB, "workspace.created");
    const relay = new OutboxRelay(database.pool, queue, subs);
    for (const q of subs.allQueues()) await queue.ensureQueue(q);
    expect(await relay.drain()).toBe(2);
    expect(await unpublished()).toBe(0);
    expect((await jobs("sla.recompute")).map((j) => j.data.workspace_id)).toEqual([wsA]);
    expect((await jobs("ai.triage")).map((j) => j.data.type)).toEqual(["issue.created"]);
    expect((await jobs("webhooks.deliver")).map((j) => j.data.workspace_id).sort()).toEqual([wsA, wsB].sort());
  });

  it("marks events with no subscribers as published without creating jobs", async () => {
    await emit(wsA, "nobody.cares");
    const relay = new OutboxRelay(database.pool, queue, new Subscriptions());
    expect(await relay.drain()).toBe(1);
    expect(await unpublished()).toBe(0);
    const { rows } = await owner.query("SELECT count(*)::int AS n FROM pgboss.job");
    expect(rows[0].n).toBe(0);
  });

  it("loses nothing when enqueueing fails: the claim rolls back", async () => {
    await emit(wsA, "issue.created");
    const failing: JobQueue = { ...queue, send: async () => { throw new Error("queue down"); } };
    const relay = new OutboxRelay(database.pool, failing, subs);
    await expect(relay.drain()).rejects.toThrow("queue down");
    expect(await unpublished()).toBe(1);
    // recovers on the next run with a healthy queue
    expect(await new OutboxRelay(database.pool, queue, subs).drain()).toBe(1);
    expect(await jobs("ai.triage")).toHaveLength(1);
  });

  it("enqueues inside the claim transaction (a partial batch never commits)", async () => {
    await emit(wsA, "issue.created");
    let sends = 0;
    const flaky: JobQueue = {
      ...queue,
      send: async (q: string, data: object, opts?: SendOptions) => {
        sends += 1;
        if (sends === 2) throw new Error("second send fails");
        return queue.send(q, data, opts);
      },
    };
    await expect(new OutboxRelay(database.pool, flaky, subs).drain()).rejects.toThrow();
    const { rows } = await owner.query("SELECT count(*)::int AS n FROM pgboss.job");
    expect(rows[0].n).toBe(0); // the first job was rolled back together with the claim
    expect(await unpublished()).toBe(1);
  });

  it("uses deterministic job ids so a replayed event cannot create duplicates", async () => {
    await emit(wsA, "issue.created");
    await new OutboxRelay(database.pool, queue, subs).drain();
    const [job] = await jobs("ai.triage");
    expect(job!.id).toBe(jobIdFor(job!.data.event_id, job!.data.created_at, "ai.triage"));
    // simulate a crash after commit-but-before-ack by un-publishing and relaying again
    await owner.query("UPDATE outbox SET published_at = NULL");
    await new OutboxRelay(database.pool, queue, subs).drain();
    expect(await jobs("ai.triage")).toHaveLength(1);
  });

  it("does not create events when the business transaction rolls back", async () => {
    await expect(
      withWorkspace(database.db, { workspaceId: wsA }, async (tx) => {
        await tx.insert(schema.outbox).values({ workspaceId: wsA, type: "issue.created", payload: {} });
        throw new Error("business rule failed");
      }),
    ).rejects.toThrow("business rule failed");
    expect(await unpublished()).toBe(0);
  });

  it("the app role cannot read other tenants' events except through claim_outbox()", async () => {
    await emit(wsB, "secret.event");
    const visible = await withWorkspace(database.db, { workspaceId: wsA }, (tx) => tx.select().from(schema.outbox));
    expect(visible).toHaveLength(0);
  });

  it("delivers events end-to-end to a worker via LISTEN/NOTIFY", async () => {
    const received: string[] = [];
    const s = new Subscriptions().subscribe("ping", "test.e2e");
    await queue.work<{ type: string; workspace_id: string }>("test.e2e", async (job) => {
      received.push(`${job.data.workspace_id}:${job.data.type}`);
    }, { pollSeconds: 0.5 });
    const relay = new OutboxRelay(database.pool, queue, s, { pollMs: 60_000 });
    await relay.start();
    await emit(wsA, "ping");
    const deadline = Date.now() + 10_000;
    while (received.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    await relay.stop();
    expect(received).toEqual([`${wsA}:ping`]);
  });
});

describe("outbox id reuse (regression: T-206 flaky delivery)", () => {
  it("an event whose id was used before (sequence reset) still gets its job", async () => {
    const subs = new Subscriptions().subscribe("issue.created", "ai.triage");
    await queue.ensureQueue("ai.triage");
    await owner.query("TRUNCATE outbox RESTART IDENTITY"); // first event gets id 1
    await emit(wsA, "issue.created");
    await new OutboxRelay(database.pool, queue, subs).drain();
    expect(await jobs("ai.triage")).toHaveLength(1);
    await owner.query("TRUNCATE outbox RESTART IDENTITY"); // the next event reuses id 1, like after a reset or restore
    await new Promise((r) => setTimeout(r, 5)); // distinct created_at
    await emit(wsA, "issue.created");
    await new OutboxRelay(database.pool, queue, subs).drain();
    const all = await jobs("ai.triage");
    expect(all).toHaveLength(2);                        // with ids keyed on event id alone, this was 1: the job was dropped
    expect(all[0]!.data.event_id).toBe(all[1]!.data.event_id);
  });
});

describe("jobIdFor", () => {
  it("is a stable RFC-4122-shaped UUID per (event, queue)", () => {
    const at = new Date("2026-11-23T10:00:00.123Z");
    const a = jobIdFor(42, at, "q1");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(jobIdFor(42, at.toISOString(), "q1")).toBe(a); // Date or its ISO string: same id
    expect(jobIdFor(42, at, "q2")).not.toBe(a);
  });

  it("a reused event id (sequence reset, restored backup) does not collide with an older job", () => {
    expect(jobIdFor(42, "2026-11-23T10:00:00.000Z", "q1")).not.toBe(jobIdFor(42, "2026-11-24T08:00:00.000Z", "q1"));
  });
});

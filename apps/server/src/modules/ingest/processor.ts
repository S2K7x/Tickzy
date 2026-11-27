import { and, asc, eq, sql } from "drizzle-orm";
import { schema, withWorkspace, type Db, type Tx } from "@tickzy/db";
import type { IngestRegistry } from "./channel.ts";

/**
 * Worker side of ingestion (T-301): processes one stored inbound event with its channel, exactly once in effect.
 * - Already handled (processed/ignored/failed) → no-op, so redelivered jobs are harmless.
 * - In arrival order per workspace and channel: earlier pending events are processed first (see below).
 * - The channel runs in a savepoint; if it throws, its partial work is rolled back but the attempt and the error
 *   (message only — never the payload) are recorded, then the error is rethrown so the queue retries with backoff.
 * - On the last attempt the event is marked `failed` (kept for inspection until retention).
 */
export async function processInboundEvent(db: Db, registry: IngestRegistry, job: { workspaceId: string; inboundEventId: string; finalAttempt: boolean }, log: (msg: string, err?: unknown) => void): Promise<void> {
  const failure = await withWorkspace(db, { workspaceId: job.workspaceId }, async (tx) => {
    // In-order processing per workspace (ADR-032 amendment): replies must not overtake the message they answer
    // (found with email: an auto-reply processed before its original found no thread). One transaction-level lock
    // per workspace serialises its processing; other workspaces proceed in parallel.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inbound:${job.workspaceId}`}, 0))`);
    const [target] = await tx.select().from(schema.inboundEvents).where(eq(schema.inboundEvents.id, job.inboundEventId)).for("update");
    if (!target || target.status !== "received") return null;
    // Drain everything of this channel that arrived before it (oldest first), then the event itself. Jobs for
    // events handled here become no-ops when they run.
    const pending = await tx.select().from(schema.inboundEvents)
      .where(and(eq(schema.inboundEvents.status, "received"), eq(schema.inboundEvents.channel, target.channel),
        sql`(${schema.inboundEvents.receivedAt}, ${schema.inboundEvents.id}) <= (${target.receivedAt}, ${target.id})`))
      .orderBy(asc(schema.inboundEvents.receivedAt), asc(schema.inboundEvents.id)).limit(100).for("update");
    if (!pending.some((e) => e.id === target.id)) pending.push(target);
    let targetError: unknown = null;
    for (const ev of pending) {
      const isTarget = ev.id === target.id;
      const err = await processOne(tx, registry, ev, isTarget && job.finalAttempt);
      // An earlier event that fails does not block the rest: its own job retries it.
      if (err && isTarget) targetError = err;
      else if (err) log(`inbound event ${ev.id} failed while draining; its own job will retry`, err);
    }
    return targetError;
  });
  if (failure) {
    log(`inbound event ${job.inboundEventId} failed${job.finalAttempt ? " (giving up)" : ", will retry"}`, failure);
    if (!job.finalAttempt) throw failure;
  }
}

/** Runs one event's channel in a savepoint and records the outcome; returns the error, if any. */
async function processOne(tx: Tx, registry: IngestRegistry, ev: typeof schema.inboundEvents.$inferSelect, finalAttempt: boolean): Promise<unknown> {
  const channel = registry.get(ev.channel);
  if (!channel) {
    await tx.update(schema.inboundEvents).set({ status: "ignored", lastError: `no channel ${ev.channel} in this process`, processedAt: new Date() }).where(eq(schema.inboundEvents.id, ev.id));
    return null;
  }
  try {
    const outcome = await tx.transaction((sp) => channel.process(sp, {
      id: ev.id, workspaceId: ev.workspaceId, connectionId: ev.connectionId, endpointId: ev.endpointId, providerEventId: ev.providerEventId, payload: ev.payload,
    }));
    await tx.update(schema.inboundEvents).set({ status: outcome, attempts: sql`${schema.inboundEvents.attempts} + 1`, lastError: null, processedAt: new Date() })
      .where(eq(schema.inboundEvents.id, ev.id));
    return null;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    await tx.update(schema.inboundEvents).set({
      attempts: sql`${schema.inboundEvents.attempts} + 1`, lastError: message,
      ...(finalAttempt ? { status: "failed" as const, processedAt: new Date() } : {}),
    }).where(eq(schema.inboundEvents.id, ev.id));
    return err;
  }
}

/** Retention (threat model §6.1): removes handled raw events older than `days`. Returns how many were removed. */
export async function purgeInboundEvents(db: Db, days: number): Promise<number> {
  const res = await db.execute(sql`SELECT purge_inbound_events(make_interval(days => ${days})) AS n`);
  return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
}

import { eq, sql } from "drizzle-orm";
import { schema, withWorkspace, type Db } from "@tickzy/db";
import type { IngestRegistry } from "./channel.ts";

/**
 * Worker side of ingestion (T-301): processes one stored inbound event with its channel, exactly once in effect.
 * - Already handled (processed/ignored/failed) → no-op, so redelivered jobs are harmless.
 * - The channel runs in a savepoint; if it throws, its partial work is rolled back but the attempt and the error
 *   (message only — never the payload) are recorded, then the error is rethrown so the queue retries with backoff.
 * - On the last attempt the event is marked `failed` (kept for inspection until retention).
 */
export async function processInboundEvent(db: Db, registry: IngestRegistry, job: { workspaceId: string; inboundEventId: string; finalAttempt: boolean }, log: (msg: string, err?: unknown) => void): Promise<void> {
  const failure = await withWorkspace(db, { workspaceId: job.workspaceId }, async (tx) => {
    const [ev] = await tx.select().from(schema.inboundEvents).where(eq(schema.inboundEvents.id, job.inboundEventId)).for("update");
    if (!ev || ev.status !== "received") return null;
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
        ...(job.finalAttempt ? { status: "failed" as const, processedAt: new Date() } : {}),
      }).where(eq(schema.inboundEvents.id, ev.id));
      return err;
    }
  });
  if (failure) {
    log(`inbound event ${job.inboundEventId} failed${job.finalAttempt ? " (giving up)" : ", will retry"}`, failure);
    if (!job.finalAttempt) throw failure;
  }
}

/** Retention (threat model §6.1): removes handled raw events older than `days`. Returns how many were removed. */
export async function purgeInboundEvents(db: Db, days: number): Promise<number> {
  const res = await db.execute(sql`SELECT purge_inbound_events(make_interval(days => ${days})) AS n`);
  return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
}

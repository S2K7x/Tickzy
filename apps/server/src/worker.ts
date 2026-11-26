import type { Database } from "@tickzy/db";
import type { JobQueue } from "./jobs/queue.ts";
import { OutboxRelay } from "./jobs/relay.ts";
import { registerConsumers } from "./jobs/consumers.ts";
import type { DeliveryRegistry } from "./modules/messages/delivery.ts";
import type { IngestRegistry } from "./modules/ingest/channel.ts";
import { purgeInboundEvents } from "./modules/ingest/processor.ts";

export interface Worker {
  stop(): Promise<void>;
}

/** The `worker` process role (architecture §3): outbox relay + job consumers. */
export async function startWorker(deps: { database: Database; queue: JobQueue; channels: DeliveryRegistry; ingest?: IngestRegistry; inboundRetentionDays?: number; log: (msg: string, err?: unknown) => void; pollMs?: number }): Promise<Worker> {
  await deps.queue.start();
  const consumers = registerConsumers(deps);
  await consumers.start();
  const relay = new OutboxRelay(deps.database.pool, deps.queue, consumers.subscriptions, { log: deps.log, ...(deps.pollMs ? { pollMs: deps.pollMs } : {}) });
  await relay.start();
  // Retention of raw provider payloads (threat model §6.1): hourly, and once at start.
  const purge = () => purgeInboundEvents(deps.database.db, deps.inboundRetentionDays ?? 30)
    .catch((err: unknown) => deps.log("inbound retention purge failed", err));
  void purge();
  const purgeTimer = setInterval(() => void purge(), 60 * 60 * 1000);
  purgeTimer.unref();
  return {
    async stop() {
      clearInterval(purgeTimer);
      await relay.stop();
      await deps.queue.stop();
    },
  };
}

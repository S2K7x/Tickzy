import type { Database } from "@tickzy/db";
import type { JobQueue } from "./jobs/queue.ts";
import { OutboxRelay } from "./jobs/relay.ts";
import { registerConsumers } from "./jobs/consumers.ts";
import type { DeliveryRegistry } from "./modules/messages/delivery.ts";

export interface Worker {
  stop(): Promise<void>;
}

/** The `worker` process role (architecture §3): outbox relay + job consumers. */
export async function startWorker(deps: { database: Database; queue: JobQueue; channels: DeliveryRegistry; log: (msg: string, err?: unknown) => void; pollMs?: number }): Promise<Worker> {
  await deps.queue.start();
  const consumers = registerConsumers(deps);
  await consumers.start();
  const relay = new OutboxRelay(deps.database.pool, deps.queue, consumers.subscriptions, { log: deps.log, ...(deps.pollMs ? { pollMs: deps.pollMs } : {}) });
  await relay.start();
  return {
    async stop() {
      await relay.stop();
      await deps.queue.stop();
    },
  };
}

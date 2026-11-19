import type { Database } from "@tickzy/db";
import type { JobQueue } from "./jobs/queue.ts";
import { OutboxRelay } from "./jobs/relay.ts";
import { registerConsumers } from "./jobs/consumers.ts";

export interface Worker {
  stop(): Promise<void>;
}

/** The `worker` process role (architecture §3): outbox relay + job consumers. */
export async function startWorker(deps: { database: Database; queue: JobQueue; log: (msg: string, err?: unknown) => void }): Promise<Worker> {
  await deps.queue.start();
  const subs = registerConsumers(deps);
  const relay = new OutboxRelay(deps.database.pool, deps.queue, subs, { log: deps.log });
  await relay.start();
  return {
    async stop() {
      await relay.stop();
      await deps.queue.stop();
    },
  };
}

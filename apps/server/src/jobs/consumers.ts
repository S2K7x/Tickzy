import type { Database } from "@tickzy/db";
import type { JobQueue } from "./queue.ts";
import { Subscriptions } from "./relay.ts";
import type { DeliveryRegistry } from "../modules/messages/delivery.ts";
import { deliverPendingMessage } from "../modules/messages/service.ts";

/** Job payload produced by the outbox relay. */
export interface OutboxJob {
  event_id: number;
  workspace_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export const DELIVER_MESSAGE_QUEUE = "deliver-message";

/**
 * Central registry of event subscriptions and their consumers. Modules add entries here as they are built
 * (SLA recompute in M4, AI triage in M5, webhooks in M6 …).
 */
export function registerConsumers(deps: { database: Database; queue: JobQueue; channels: DeliveryRegistry; log: (msg: string, err?: unknown) => void }): { subscriptions: Subscriptions; start(): Promise<void> } {
  const subscriptions = new Subscriptions()
    .subscribe("message.created", DELIVER_MESSAGE_QUEUE)
    .subscribe("message.retry_requested", DELIVER_MESSAGE_QUEUE);
  return {
    subscriptions,
    async start() {
      // T-205: outbound delivery. Events for messages that need no delivery are skipped by the handler.
      await deps.queue.work<OutboxJob>(DELIVER_MESSAGE_QUEUE, async (job) => {
        if (job.data.payload.deliver !== true) return;
        await deliverPendingMessage(deps.database.db, deps.channels,
          { workspaceId: job.data.workspace_id, messageId: String(job.data.payload.message_id), retryCount: job.retryCount }, deps.log);
      }, { concurrency: 2 });
    },
  };
}

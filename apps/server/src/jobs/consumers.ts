import type { Database } from "@tickzy/db";
import type { JobQueue } from "./queue.ts";
import { Subscriptions } from "./relay.ts";

/**
 * Central registry of event subscriptions and their consumers. Modules add entries here as they are built
 * (SLA recompute in M4, AI triage in M5, webhooks in M6 …). M0 registers none — events are relayed and
 * marked published, and no job is created until a consumer exists.
 */
export function registerConsumers(_deps: { database: Database; queue: JobQueue }): Subscriptions {
  return new Subscriptions();
}

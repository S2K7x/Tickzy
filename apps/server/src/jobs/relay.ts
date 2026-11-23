import { createHash } from "node:crypto";
import type pg from "pg";
import type { JobQueue } from "./queue.ts";

export interface DomainEvent {
  id: number;
  workspace_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Maps domain event types to the queues that consume them. `*` matches every event. */
export class Subscriptions {
  private readonly map = new Map<string, Set<string>>();

  subscribe(eventType: string, queue: string): this {
    if (!this.map.has(eventType)) this.map.set(eventType, new Set());
    this.map.get(eventType)!.add(queue);
    return this;
  }

  queuesFor(eventType: string): string[] {
    return [...new Set([...(this.map.get(eventType) ?? []), ...(this.map.get("*") ?? [])])].sort();
  }

  allQueues(): string[] {
    return [...new Set([...this.map.values()].flatMap((s) => [...s]))].sort();
  }
}

/**
 * Deterministic UUID for (event, queue): replays of the same event can never create a duplicate job.
 * The event's creation time is part of the key, so an outbox id that is reused (sequence reset, database restored
 * from a backup) can never collide with an older job and be silently dropped as a "duplicate".
 */
export function jobIdFor(eventId: number, createdAt: Date | string, queue: string): string {
  const at = new Date(createdAt).toISOString();
  const h = createHash("sha256").update(`outbox:${eventId}:${at}:${queue}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/**
 * Outbox relay (architecture §5.1). Each batch runs in ONE transaction: claim rows (marks them published),
 * enqueue one job per subscribed queue on the same connection, commit. A failure anywhere rolls the claim back,
 * so events are delivered at least once and never lost. Consumers must be idempotent.
 */
export class OutboxRelay {
  private listener: pg.PoolClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private pending = false;

  private readonly pool: pg.Pool;
  private readonly queue: JobQueue;
  private readonly subs: Subscriptions;
  private readonly opts: { batchSize?: number; pollMs?: number; log?: (msg: string, err?: unknown) => void };

  constructor(
    pool: pg.Pool,
    queue: JobQueue,
    subs: Subscriptions,
    opts: { batchSize?: number; pollMs?: number; log?: (msg: string, err?: unknown) => void } = {},
  ) {
    this.pool = pool;
    this.queue = queue;
    this.subs = subs;
    this.opts = opts;
  }

  /** Relays until the outbox is empty. Returns the number of events processed. */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.relayBatch();
      total += n;
      if (n === 0) return total;
    }
  }

  async relayBatch(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<DomainEvent>("SELECT * FROM claim_outbox($1)", [this.opts.batchSize ?? 100]);
      rows.sort((a, b) => Number(a.id) - Number(b.id));
      for (const ev of rows) {
        for (const q of this.subs.queuesFor(ev.type)) {
          await this.queue.send(
            q,
            { event_id: Number(ev.id), workspace_id: ev.workspace_id, type: ev.type, payload: ev.payload, created_at: ev.created_at },
            { tx: client, id: jobIdFor(Number(ev.id), ev.created_at, q) },
          );
        }
      }
      await client.query("COMMIT");
      return rows.length;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Starts LISTEN-driven relaying with a polling backstop. */
  async start(): Promise<void> {
    for (const q of this.subs.allQueues()) await this.queue.ensureQueue(q);
    this.running = true;
    this.listener = await this.pool.connect();
    this.listener.on("notification", () => this.kick());
    await this.listener.query("LISTEN tz_outbox");
    this.timer = setInterval(() => this.kick(), this.opts.pollMs ?? 5_000);
    this.kick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.listener) {
      await this.listener.query("UNLISTEN tz_outbox").catch(() => undefined);
      this.listener.release();
      this.listener = null;
    }
  }

  private kick(): void {
    if (!this.running) return;
    if (this.pending) return;
    this.pending = true;
    this.drain()
      .catch((err) => this.opts.log?.("outbox relay failed", err))
      .finally(() => {
        this.pending = false;
      });
  }
}

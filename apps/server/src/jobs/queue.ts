import { PgBoss } from "pg-boss";
import type pg from "pg";

/** Executes SQL on a specific connection — lets a job be enqueued inside the caller's transaction. */
export interface SqlExecutor {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface SendOptions {
  /** Enqueue inside this transaction (atomic with the caller's writes). */
  tx?: SqlExecutor;
  /** Deterministic job id (UUID). A second send with the same id is ignored. */
  id?: string;
  startAfter?: Date | number;
  singletonKey?: string;
  retryLimit?: number;
}

export interface JobContext<T> {
  id: string;
  queue: string;
  data: T;
  retryCount: number;
}

export type JobHandler<T> = (job: JobContext<T>) => Promise<void>;

/** The only queue API the rest of the code base may use (ADR-007): pg-boss stays swappable. */
export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  ensureQueue(name: string): Promise<void>;
  send<T extends object>(queue: string, data: T, opts?: SendOptions): Promise<string | null>;
  work<T>(queue: string, handler: JobHandler<T>, opts?: { concurrency?: number; pollSeconds?: number }): Promise<void>;
}

export function createPgBossQueue(connectionString: string): JobQueue {
  const boss = new PgBoss({ connectionString, schema: "pgboss", supervise: true, schedule: false });
  const created = new Set<string>();
  boss.on("error", (err: unknown) => console.error("[pg-boss]", err));

  return {
    async start() {
      await boss.start();
    },
    async stop() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
    async ensureQueue(name) {
      if (created.has(name)) return;
      await boss.createQueue(name, { retryLimit: 5, retryDelay: 5, retryBackoff: true });
      created.add(name);
    },
    async send(queue, data, opts = {}) {
      return boss.send(queue, data, {
        ...(opts.id ? { id: opts.id } : {}),
        ...(opts.startAfter !== undefined ? { startAfter: opts.startAfter instanceof Date ? opts.startAfter : new Date(opts.startAfter) } : {}),
        ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
        ...(opts.retryLimit !== undefined ? { retryLimit: opts.retryLimit } : {}),
        ...(opts.tx ? { db: { executeSql: (text: string, values?: unknown[]) => opts.tx!.query(text, values) as Promise<{ rows: unknown[] }> } } : {}),
      });
    },
    async work<T>(queue: string, handler: JobHandler<T>, opts: { concurrency?: number; pollSeconds?: number } = {}) {
      await this.ensureQueue(queue);
      const workers = Math.max(1, opts.concurrency ?? 1);
      for (let i = 0; i < workers; i++) {
        await boss.work<T>(queue, { batchSize: 1, pollingIntervalSeconds: opts.pollSeconds ?? 2 }, async (jobs) => {
          for (const job of jobs) {
            await handler({ id: job.id, queue, data: job.data, retryCount: job.retryCount });
          }
        });
      }
    },
  };
}

export type { pg };

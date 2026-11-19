import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

/** Runtime connection. In production this MUST be the `tickzy_app` role (no BYPASSRLS). */
export function createDatabase(url: string, opts: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

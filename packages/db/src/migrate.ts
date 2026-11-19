import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { getConstructionPlans } from "pg-boss";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const LOCK_KEY = 727_001; // arbitrary constant for pg_advisory_lock

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies `migrations/*.sql` in lexical order, each in its own transaction, recording name + checksum.
 * Must run with the owner role (creates roles/policies). Refuses to continue if an applied file changed.
 */
export async function migrate(ownerUrl: string, dir: string = MIGRATIONS_DIR): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM _migrations");
    const done = new Map(rows.map((r) => [r.name, r.checksum]));
    const result: MigrationResult = { applied: [], skipped: [] };
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = done.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        result.skipped.push(file);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
        await client.query("COMMIT");
        result.applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    await installJobQueueSchema(client);
    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

/**
 * Installs pg-boss's schema with the owner role, then gives every object in it to `tickzy_app` (ADR-020).
 * The runtime role therefore never needs CREATE on the database, yet can create per-queue partitions
 * and run pg-boss's own version upgrades inside the schema it owns.
 */
export async function installJobQueueSchema(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ installed: string | null }>("SELECT to_regclass('pgboss.version')::text AS installed");
  if (!rows[0]?.installed) await client.query(getConstructionPlans("pgboss"));
  await client.query(`DO $$
    DECLARE r record;
    BEGIN
      EXECUTE 'ALTER SCHEMA pgboss OWNER TO tickzy_app';
      FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'p', 'S', 'v') LOOP
        EXECUTE format('ALTER %s pgboss.%I OWNER TO tickzy_app',
          CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END, r.relname);
      END LOOP;
      FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
               WHERE n.nspname = 'pgboss' AND t.typtype IN ('e', 'd') LOOP
        EXECUTE format('ALTER TYPE pgboss.%I OWNER TO tickzy_app', r.typname);
      END LOOP;
      FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'pgboss' LOOP
        EXECUTE format('ALTER ROUTINE %s OWNER TO tickzy_app', r.sig);
      END LOOP;
    END $$`);
}

import pg from "pg";
import { migrate } from "./migrate.ts";
import { createDatabase, type Database } from "./client.ts";

// Roles are cluster-wide: use the same local password as .env.example so running tests never breaks a dev server
// sharing the same Postgres cluster. Override with TICKZY_APP_PASSWORD.
export const TEST_APP_PASSWORD = process.env.TICKZY_APP_PASSWORD ?? "tickzy_app";

export function testOwnerUrl(): string {
  return process.env.DATABASE_OWNER_URL ?? "postgres://tickzy_owner:tickzy@localhost:5432/tickzy_test";
}

/** Same host/db as the owner URL, but connecting as the RLS-bound runtime role. */
export function appUrlFrom(ownerUrl: string, password = TEST_APP_PASSWORD): string {
  const u = new URL(ownerUrl);
  u.username = "tickzy_app";
  u.password = password;
  return u.toString();
}

/** Drops and recreates the public schema, applies migrations, and returns a runtime (app-role) connection. */
export async function resetTestDatabase(ownerUrl = testOwnerUrl()): Promise<{ app: Database; owner: pg.Client; appUrl: string }> {
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
  await migrate(ownerUrl);
  await owner.query(`ALTER ROLE tickzy_app PASSWORD '${TEST_APP_PASSWORD}'`);
  const appUrl = appUrlFrom(ownerUrl);
  return { app: createDatabase(appUrl, { max: 4 }), owner, appUrl };
}

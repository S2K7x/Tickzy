import pg from "pg";
import { migrate } from "./migrate.ts";
import { createDatabase, type Database } from "./client.ts";

export const TEST_APP_PASSWORD = "tickzy_app_test";

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

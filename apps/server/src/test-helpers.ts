import { sql } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { resetTestDatabase } from "@tickzy/db/testing";
import type { Database } from "@tickzy/db";
import type pg from "pg";
import { buildApp } from "./app.ts";
import { MemoryEmailTransport } from "./lib/email.ts";

export const TEST_ORIGIN = "http://localhost:5173";
// Rate limits are high here so functional suites never trip them; rate-limit.test.ts uses small ones.
export const testConfig = {
  LOG_LEVEL: "silent" as const, AUTH_DEV_MODE: true, APP_ORIGIN: TEST_ORIGIN, ALLOWED_ORIGINS: "", COOKIE_SECURE: true,
  TRUST_PROXY: "false", RATE_LIMIT_PER_MIN: 100_000, RATE_LIMIT_IP_PER_MIN: 100_000, RATE_LIMIT_AUTH_PER_MIN: 100_000,
};

export async function setupTestApp() {
  const { app: database, owner } = await resetTestDatabase();
  const email = new MemoryEmailTransport();
  const app = await buildApp({ config: testConfig, database, email });
  return {
    app,
    database,
    email,
    /** Superuser-ish owner connection for arranging states the app role may not create (e.g. expiry). */
    owner: owner as pg.Client,
    async createUser(email: string): Promise<string> {
      const id = newId("user");
      const res = await database.db.execute(sql`SELECT upsert_user(${id}, ${email}, ${email}) AS id`);
      return String(res.rows[0]!.id);
    },
    async teardown() {
      await app.close();
      await database.close();
      await (owner as pg.Client).end();
    },
  };
}

export const auth = (userId: string, workspaceId?: string): Record<string, string> => ({
  authorization: `Bearer dev_${userId}`,
  ...(workspaceId ? { "tickzy-workspace": workspaceId } : {}),
});

export type TestDb = Database;

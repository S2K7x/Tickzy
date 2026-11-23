import { sql } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { resetTestDatabase } from "@tickzy/db/testing";
import type { Database } from "@tickzy/db";
import type pg from "pg";
import { buildApp } from "./app.ts";
import { MemoryEmailTransport } from "./modules/auth/email.ts";

export const TEST_ORIGIN = "http://localhost:5173";
export const testConfig = { LOG_LEVEL: "silent" as const, AUTH_DEV_MODE: true, APP_ORIGIN: TEST_ORIGIN, ALLOWED_ORIGINS: "", COOKIE_SECURE: true };

export async function setupTestApp() {
  const { app: database, owner } = await resetTestDatabase();
  const email = new MemoryEmailTransport();
  const app = await buildApp({ config: testConfig, database, email });
  return {
    app,
    database,
    email,
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

import { sql } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import { resetTestDatabase } from "@tickzy/db/testing";
import type { Database } from "@tickzy/db";
import type pg from "pg";
import { buildApp } from "./app.ts";

export async function setupTestApp() {
  const { app: database, owner } = await resetTestDatabase();
  const app = await buildApp({ config: { LOG_LEVEL: "silent", AUTH_DEV_MODE: true }, database });
  return {
    app,
    database,
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

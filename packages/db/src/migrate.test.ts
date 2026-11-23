import { describe, expect, it } from "vitest";
import { migrate } from "./migrate.ts";
import { resetTestDatabase, testOwnerUrl } from "./testing.ts";

describe("migrations", () => {
  it("apply on a fresh database and are idempotent", async () => {
    const { app, owner } = await resetTestDatabase();
    const again = await migrate(testOwnerUrl());
    expect(again.applied).toEqual([]);
    expect(again.skipped.length).toBeGreaterThan(0);
    const { rows } = await owner.query(
      "SELECT relname FROM pg_class WHERE relrowsecurity AND relforcerowsecurity AND relkind = 'r' ORDER BY relname",
    );
    expect(rows.map((r) => r.relname)).toEqual(["audit_log", "login_tokens", "memberships", "outbox", "sessions", "users", "workspace_counters", "workspaces"]);
    await app.close();
    await owner.end();
  });

  it("installs the job-queue schema owned by the runtime role, without database-level CREATE", async () => {
    const { app, owner } = await resetTestDatabase();
    const owners = await owner.query(
      `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'pgboss'`,
    );
    expect(owners.rows.map((r) => r.owner)).toEqual(["tickzy_app"]);
    const priv = await app.pool.query("SELECT has_database_privilege(current_database(), 'CREATE') AS can_create");
    expect(priv.rows[0].can_create).toBe(false);
    // re-running migrations keeps the install intact (idempotent)
    await migrate(testOwnerUrl());
    const version = await owner.query("SELECT count(*)::int AS n FROM pgboss.version");
    expect(version.rows[0].n).toBe(1);
    await app.close();
    await owner.end();
  });
});

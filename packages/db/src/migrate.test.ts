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
    expect(rows.map((r) => r.relname)).toEqual(["audit_log", "memberships", "outbox", "users", "workspace_counters", "workspaces"]);
    await app.close();
    await owner.end();
  });
});

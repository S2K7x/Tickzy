import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { newId } from "@tickzy/shared";
import type pg from "pg";
import { resetTestDatabase } from "./testing.ts";
import { withUser, withWorkspace } from "./tenancy.ts";
import type { Database } from "./client.ts";
import { auditLog, memberships, outbox, users, workspaces } from "./schema.ts";

let app: Database;
let owner: pg.Client;
const wsA = newId("workspace");
const wsB = newId("workspace");
const userA = newId("user");
const userB = newId("user");

beforeAll(async () => {
  ({ app, owner } = await resetTestDatabase());
  // Users are created through the narrow SECURITY DEFINER entry point, as sign-up will.
  await app.db.execute(sql`SELECT upsert_user(${userA}, 'a@example.com', 'Ann')`);
  await app.db.execute(sql`SELECT upsert_user(${userB}, 'b@example.com', 'Ben')`);
  for (const [ws, user, slug] of [[wsA, userA, "alpha"], [wsB, userB, "beta"]] as const) {
    await withWorkspace(app.db, { workspaceId: ws, userId: user }, async (tx) => {
      await tx.insert(workspaces).values({ id: ws, name: slug, slug, issuePrefix: "TKZ" });
      await tx.insert(memberships).values({ id: newId("membership"), workspaceId: ws, userId: user, role: "admin" });
      await tx.insert(auditLog).values({ id: newId("auditLog"), workspaceId: ws, actorType: "user", actorId: user, action: "workspace.created" });
      await tx.insert(outbox).values({ workspaceId: ws, type: "workspace.created", payload: { id: ws } });
    });
  }
});

/** Drizzle wraps driver errors ("Failed query: …"); assert on the underlying Postgres error. */
async function expectPgError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const err = await promise.then(
    () => { throw new Error("expected the query to fail"); },
    (e: unknown) => e as Error & { cause?: Error },
  );
  expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(pattern);
}

afterAll(async () => {
  await app.close();
  await owner.end();
});

describe("row-level security (tenant isolation)", () => {
  it("runtime role cannot bypass RLS", async () => {
    const { rows } = await app.pool.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user");
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("sees nothing without a tenant context", async () => {
    for (const table of [workspaces, memberships, auditLog, outbox]) {
      expect(await app.db.select().from(table)).toHaveLength(0);
    }
  });

  it("sees only its own tenant's rows", async () => {
    await withWorkspace(app.db, { workspaceId: wsA }, async (tx) => {
      expect((await tx.select().from(workspaces)).map((w) => w.id)).toEqual([wsA]);
      expect((await tx.select().from(memberships)).every((m) => m.workspaceId === wsA)).toBe(true);
      expect((await tx.select().from(auditLog)).every((a) => a.workspaceId === wsA)).toBe(true);
      expect((await tx.select().from(outbox)).every((o) => o.workspaceId === wsA)).toBe(true);
    });
  });

  it("cannot insert rows into another tenant", async () => {
    await expectPgError(
      withWorkspace(app.db, { workspaceId: wsA }, (tx) =>
        tx.insert(memberships).values({ id: newId("membership"), workspaceId: wsB, userId: userA, role: "agent" }),
      ),
      /row-level security/,
    );
  });

  it("cannot update or delete another tenant's rows", async () => {
    await withWorkspace(app.db, { workspaceId: wsA }, async (tx) => {
      const updated = await tx.update(workspaces).set({ name: "hijacked" }).where(eq(workspaces.id, wsB)).returning();
      expect(updated).toHaveLength(0);
      const deleted = await tx.delete(memberships).where(eq(memberships.workspaceId, wsB)).returning();
      expect(deleted).toHaveLength(0);
    });
    await withWorkspace(app.db, { workspaceId: wsB }, async (tx) => {
      expect((await tx.select().from(workspaces))[0]?.name).toBe("beta");
      expect(await tx.select().from(memberships)).toHaveLength(1);
    });
  });

  it("cannot move a row to another tenant", async () => {
    await expectPgError(
      withWorkspace(app.db, { workspaceId: wsA }, (tx) => tx.update(memberships).set({ workspaceId: wsB })),
      /row-level security/,
    );
  });

  it("audit log is append-only for the app role", async () => {
    await expectPgError(
      withWorkspace(app.db, { workspaceId: wsA }, (tx) => tx.update(auditLog).set({ action: "tampered" })),
      /permission denied/,
    );
    await expectPgError(withWorkspace(app.db, { workspaceId: wsA }, (tx) => tx.delete(auditLog)), /permission denied/);
  });

  it("tenant setting does not leak across pooled transactions", async () => {
    await withWorkspace(app.db, { workspaceId: wsA }, async () => undefined);
    const { rows } = await app.pool.query("SELECT current_setting('app.workspace_id', true) AS v");
    expect(rows[0].v ?? "").toBe("");
    expect(await app.db.select().from(workspaces)).toHaveLength(0);
  });

  it("users are visible to themselves and co-workers only", async () => {
    const asA = await withUser(app.db, userA, (tx) => tx.select().from(users));
    expect(asA.map((u) => u.id)).toEqual([userA]);
    const inB = await withWorkspace(app.db, { workspaceId: wsB, userId: userA }, (tx) => tx.select().from(users));
    // In B, A sees B's members plus their own profile — but no other tenant's members.
    expect(inB.map((u) => u.id).sort()).toEqual([userA, userB].sort());
    const asB = await withWorkspace(app.db, { workspaceId: wsB, userId: userB }, (tx) => tx.select().from(users));
    expect(asB.map((u) => u.id)).toEqual([userB]);
  });

  it("my_memberships() returns only the caller's workspaces", async () => {
    const rows = await withUser(app.db, userA, (tx) => tx.execute(sql`SELECT * FROM my_memberships()`));
    expect(rows.rows.map((r) => r.workspace_id)).toEqual([wsA]);
  });

  it("rejects malformed tenant ids before touching the database", async () => {
    await expect(withWorkspace(app.db, { workspaceId: "ws_x'; drop table users;--" }, async () => 1)).rejects.toThrow(/invalid workspace id/);
  });
});

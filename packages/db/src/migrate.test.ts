import { describe, expect, it } from "vitest";
import pg from "pg";
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
    expect(rows.map((r) => r.relname)).toEqual([
      "account_domains",
      "accounts",
      "api_tokens",
      "attachments",
      "audit_log",
      "contact_identities",
      "contacts",
      "conversations",
      "custom_field_defs",
      "invitations",
      "issue_events",
      "issue_labels",
      "issues",
      "labels",
      "login_tokens",
      "memberships",
      "messages",
      "outbox",
      "sessions",
      "statuses",
      "team_members",
      "teams",
      "user_identities",
      "users",
      "workspace_counters",
      "workspaces",
    ]);
    await app.close();
    await owner.end();
  });

  it("installs the job-queue schema owned by the runtime role, without database-level CREATE", async () => {
    const { app, owner } = await resetTestDatabase();
    const owners = await owner.query(
      `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'pgboss'`,
    );
    expect(owners.rows.map((r) => r.owner)).toEqual(["tickzy_app"]);
    const priv = await app.pool.query(
      "SELECT has_database_privilege(current_database(), 'CREATE') AS can_create",
    );
    expect(priv.rows[0].can_create).toBe(false);
    // re-running migrations keeps the install intact (idempotent)
    await migrate(testOwnerUrl());
    const version = await owner.query("SELECT count(*)::int AS n FROM pgboss.version");
    expect(version.rows[0].n).toBe(1);
    await app.close();
    await owner.end();
  });

  it("run with a NON-superuser owner, as on a managed production database (incl. the 0007 backfill under forced RLS)", async () => {
    // Simulates a managed DB: an owner with CREATEROLE that holds ADMIN on tickzy_app (as its creator would on PG16+)
    // but no SET membership, owning its own database. Needs a superuser test connection to set the scene.
    const admin = new pg.Client({ connectionString: testOwnerUrl() });
    await admin.connect();
    const {
      rows: [su],
    } = await admin.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    if (!su.rolsuper) {
      await admin.end();
      return;
    } // cannot arrange roles without a superuser
    const db = "tickzy_nonsuper_test";
    await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin.query("DROP ROLE IF EXISTS tz_owner_nonsuper");
    await admin.query("CREATE ROLE tz_owner_nonsuper LOGIN PASSWORD 'x' NOSUPERUSER NOBYPASSRLS CREATEROLE");
    await admin.query("GRANT tickzy_app TO tz_owner_nonsuper WITH ADMIN TRUE, INHERIT FALSE, SET FALSE");
    await admin.query(`CREATE DATABASE ${db} OWNER tz_owner_nonsuper`);
    const url = new URL(testOwnerUrl());
    url.username = "tz_owner_nonsuper";
    url.password = "x";
    url.pathname = `/${db}`;
    try {
      // Apply everything up to 0006, create a workspace with no statuses, then apply 0007 (its backfill must reach it).
      const { readdir, mkdtemp, copyFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const path = await import("node:path");
      const src = path.join(import.meta.dirname, "..", "migrations");
      const partial = await mkdtemp(path.join(tmpdir(), "tz-mig-"));
      for (const f of (await readdir(src)).filter((f) => f < "0007"))
        await copyFile(path.join(src, f), path.join(partial, f));
      await migrate(url.toString(), partial);
      const appUrl = new URL(url);
      appUrl.username = "tickzy_app";
      appUrl.password = process.env.TICKZY_APP_PASSWORD ?? "tickzy_app";
      const appClient = new pg.Client({ connectionString: appUrl.toString() });
      await appClient.connect();
      try {
        await appClient.query("BEGIN");
        await appClient.query("SELECT set_config('app.workspace_id', 'ws_01M83TJAQ8E484QYFY3QS2B7VM', true)");
        await appClient.query(
          "INSERT INTO workspaces (id, name, slug, issue_prefix) VALUES ('ws_01M83TJAQ8E484QYFY3QS2B7VM', 'Old', 'old', 'OLD')",
        );
        await appClient.query("COMMIT");
        const result = await migrate(url.toString());
        expect(result.applied[0]).toBe("0007_customers_and_taxonomy.sql"); // and every later migration
        await appClient.query("BEGIN");
        await appClient.query("SELECT set_config('app.workspace_id', 'ws_01M83TJAQ8E484QYFY3QS2B7VM', true)");
        const { rows } = await appClient.query("SELECT count(*)::int AS n FROM statuses WHERE is_default");
        await appClient.query("COMMIT");
        expect(rows[0].n).toBe(7);
      } finally {
        await appClient.end();
      }
      const forced = await admin.query(
        `SELECT bool_and(relforcerowsecurity) AS all_forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`,
      );
      expect(forced.rows[0].all_forced).toBe(true);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.query("DROP OWNED BY tz_owner_nonsuper CASCADE").catch(() => undefined);
      await admin.query("DROP ROLE IF EXISTS tz_owner_nonsuper");
      await admin.end();
    }
  });
});

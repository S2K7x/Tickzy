import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { isId, newId } from "@tickzy/shared";
import type pg from "pg";
import { resetTestDatabase } from "./testing.ts";
import { withWorkspace } from "./tenancy.ts";
import type { Database, Tx } from "./client.ts";
import * as s from "./schema.ts";

// T-201: tenant isolation for customers & taxonomy, composite foreign keys, constraints and default statuses.
let app: Database;
let owner: pg.Client;
const wsA = newId("workspace");
const wsB = newId("workspace");
const userA = newId("user");
const memA = newId("membership");
const memB = newId("membership");
const accA = newId("account");
const conA = newId("contact");
const teamA = newId("team");
const lblA = newId("label");

const inA = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(app.db, { workspaceId: wsA }, fn);
const inB = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(app.db, { workspaceId: wsB }, fn);

async function expectPgError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const err = await promise.then(() => { throw new Error("expected the query to fail"); }, (e: unknown) => e as Error & { cause?: Error });
  expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(pattern);
}

beforeAll(async () => {
  ({ app, owner } = await resetTestDatabase());
  await app.db.execute(sql`SELECT upsert_user(${userA}, 'a@example.com', 'Ann')`);
  for (const [ws, mem, slug] of [[wsA, memA, "alpha"], [wsB, memB, "beta"]] as const) {
    await withWorkspace(app.db, { workspaceId: ws }, async (tx) => {
      await tx.insert(s.workspaces).values({ id: ws, name: slug, slug, issuePrefix: "TKZ" });
      await tx.insert(s.memberships).values({ id: mem, workspaceId: ws, userId: userA, role: "admin" });
      await tx.execute(sql`SELECT seed_workspace_defaults()`);
    });
  }
  await inA(async (tx) => {
    await tx.insert(s.accounts).values({ id: accA, workspaceId: wsA, name: "Globex", tier: "enterprise", ownerMembershipId: memA });
    await tx.insert(s.accountDomains).values({ workspaceId: wsA, domain: "globex.com", accountId: accA });
    await tx.insert(s.contacts).values({ id: conA, workspaceId: wsA, accountId: accA, name: "Hank" });
    await tx.insert(s.contactIdentities).values({ id: newId("contactIdentity"), workspaceId: wsA, contactId: conA, kind: "email", externalKey: "hank@globex.com" });
    await tx.insert(s.teams).values({ id: teamA, workspaceId: wsA, name: "Tier 1" });
    await tx.insert(s.teamMembers).values({ workspaceId: wsA, teamId: teamA, membershipId: memA });
    await tx.insert(s.labels).values({ id: lblA, workspaceId: wsA, name: "Billing", color: "#ff0000" });
    await tx.insert(s.customFieldDefs).values({ id: newId("customField"), workspaceId: wsA, entity: "account", key: "arr", label: "ARR", type: "number" });
  });
});
afterAll(async () => {
  await app.close();
  await owner.end();
});

const TABLES = [s.accounts, s.accountDomains, s.contacts, s.contactIdentities, s.teams, s.teamMembers, s.labels, s.customFieldDefs];

describe("customers & taxonomy isolation (T-201)", () => {
  it("rows are invisible without a tenant context and to other workspaces", async () => {
    for (const t of [...TABLES, s.statuses]) expect(await app.db.select().from(t)).toHaveLength(0);
    for (const t of TABLES) {
      expect((await inA((tx) => tx.select().from(t))).length).toBeGreaterThan(0);
      expect(await inB((tx) => tx.select().from(t))).toHaveLength(0);
    }
  });

  it("cannot write rows into another workspace", async () => {
    await expectPgError(inB((tx) => tx.insert(s.accounts).values({ id: newId("account"), workspaceId: wsA, name: "x" })), /row-level security/);
    await expectPgError(inB((tx) => tx.insert(s.labels).values({ id: newId("label"), workspaceId: wsA, name: "x" })), /row-level security/);
  });

  it("composite foreign keys stop references to another workspace's records, even with a known id", async () => {
    await expectPgError(inB((tx) => tx.insert(s.contacts).values({ id: newId("contact"), workspaceId: wsB, accountId: accA })), /foreign key/);
    await expectPgError(inB((tx) => tx.insert(s.accountDomains).values({ workspaceId: wsB, domain: "evil.com", accountId: accA })), /foreign key/);
    await expectPgError(inB((tx) => tx.insert(s.accounts).values({ id: newId("account"), workspaceId: wsB, name: "x", ownerMembershipId: memA })), /foreign key/);
    const teamB = newId("team");
    await inB((tx) => tx.insert(s.teams).values({ id: teamB, workspaceId: wsB, name: "B team" }));
    await expectPgError(inB((tx) => tx.insert(s.teamMembers).values({ workspaceId: wsB, teamId: teamB, membershipId: memA })), /foreign key/);
    await expectPgError(inB((tx) => tx.insert(s.labels).values({ id: newId("label"), workspaceId: wsB, name: "child", parentId: lblA })), /foreign key/);
    await expectPgError(inB((tx) => tx.insert(s.contactIdentities).values({ id: newId("contactIdentity"), workspaceId: wsB, contactId: conA, kind: "email", externalKey: "x@y.com" })), /foreign key/);
  });

  it("a domain maps to one account per workspace; other workspaces may use it", async () => {
    const acc2 = newId("account");
    await inA((tx) => tx.insert(s.accounts).values({ id: acc2, workspaceId: wsA, name: "Other" }));
    await expectPgError(inA((tx) => tx.insert(s.accountDomains).values({ workspaceId: wsA, domain: "GLOBEX.com", accountId: acc2 })), /duplicate key/);
    const accB = newId("account");
    await inB(async (tx) => {
      await tx.insert(s.accounts).values({ id: accB, workspaceId: wsB, name: "Globex (B)" });
      await tx.insert(s.accountDomains).values({ workspaceId: wsB, domain: "globex.com", accountId: accB });
    });
    await expectPgError(inA((tx) => tx.insert(s.accountDomains).values({ workspaceId: wsA, domain: "not a domain", accountId: acc2 })), /check constraint/);
  });

  it("identities are unique per kind and key, and email keys must be lowercase", async () => {
    const con2 = newId("contact");
    await inA((tx) => tx.insert(s.contacts).values({ id: con2, workspaceId: wsA }));
    await expectPgError(inA((tx) => tx.insert(s.contactIdentities).values({ id: newId("contactIdentity"), workspaceId: wsA, contactId: con2, kind: "email", externalKey: "hank@globex.com" })), /duplicate key/);
    await expectPgError(inA((tx) => tx.insert(s.contactIdentities).values({ id: newId("contactIdentity"), workspaceId: wsA, contactId: con2, kind: "email", externalKey: "Upper@globex.com" })), /check constraint/);
    await inA((tx) => tx.insert(s.contactIdentities).values({ id: newId("contactIdentity"), workspaceId: wsA, contactId: con2, kind: "slack", externalKey: "T123:U456" }));
  });

  it("deleting an account keeps its contacts (account cleared) and removes its domains", async () => {
    const acc3 = newId("account");
    const con3 = newId("contact");
    await inA(async (tx) => {
      await tx.insert(s.accounts).values({ id: acc3, workspaceId: wsA, name: "Temp" });
      await tx.insert(s.accountDomains).values({ workspaceId: wsA, domain: "temp.io", accountId: acc3 });
      await tx.insert(s.contacts).values({ id: con3, workspaceId: wsA, accountId: acc3 });
    });
    await owner.query("DELETE FROM accounts WHERE id = $1", [acc3]); // hard delete path (GDPR erasure); the API soft-deletes
    const [c] = await inA((tx) => tx.select().from(s.contacts).where(sql`id = ${con3}`));
    expect(c!.accountId).toBeNull();
    expect((await inA((tx) => tx.select().from(s.accountDomains))).map((d) => d.domain)).not.toContain("temp.io");
  });

  it("validates labels and custom field definitions", async () => {
    await expectPgError(inA((tx) => tx.insert(s.labels).values({ id: newId("label"), workspaceId: wsA, name: "billing" })), /duplicate key/); // case-insensitive per parent
    await inA((tx) => tx.insert(s.labels).values({ id: newId("label"), workspaceId: wsA, name: "Billing", parentId: lblA })); // same name under a parent is fine
    await expectPgError(inA((tx) => tx.insert(s.labels).values({ id: newId("label"), workspaceId: wsA, name: "Bad", color: "red" })), /check constraint/);
    await expectPgError(inA((tx) => tx.insert(s.customFieldDefs).values({ id: newId("customField"), workspaceId: wsA, entity: "issue", key: "Bad Key", label: "x", type: "text" })), /check constraint/);
    await expectPgError(inA((tx) => tx.insert(s.customFieldDefs).values({ id: newId("customField"), workspaceId: wsA, entity: "issue", key: "plan", label: "Plan", type: "text", options: [{ id: "a", label: "A" }] })), /check constraint/);
    await inA((tx) => tx.insert(s.customFieldDefs).values({ id: newId("customField"), workspaceId: wsA, entity: "issue", key: "plan", label: "Plan", type: "select", options: [{ id: "free", label: "Free" }] }));
    await expectPgError(inA((tx) => tx.insert(s.customFieldDefs).values({ id: newId("customField"), workspaceId: wsA, entity: "issue", key: "plan", label: "Plan again", type: "text" })), /duplicate key/);
  });
});

describe("default statuses (FR-3.1)", () => {
  it("seeds one default status per category with app-format ULID ids", async () => {
    const rows = await inA((tx) => tx.select().from(s.statuses));
    expect(rows.map((r) => r.category).sort()).toEqual([...s.STATUS_CATEGORIES].sort());
    expect(rows.every((r) => r.isDefault && isId(r.id, "status"))).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(7);
    expect(rows.find((r) => r.category === "waiting_on_customer")!.name).toBe("Waiting on customer");
  });

  it("seeding is idempotent and never crosses workspaces", async () => {
    await inA((tx) => tx.execute(sql`SELECT seed_workspace_defaults()`));
    expect(await inA((tx) => tx.select().from(s.statuses))).toHaveLength(7);
    expect(await inB((tx) => tx.select().from(s.statuses))).toHaveLength(7);
    await app.db.execute(sql`SELECT seed_workspace_defaults()`); // no tenant context → no-op
  });

  it("allows custom statuses but only one default per category", async () => {
    await inA((tx) => tx.insert(s.statuses).values({ id: newId("status"), workspaceId: wsA, category: "waiting_on_us", name: "In progress", position: 1 }));
    await expectPgError(inA((tx) => tx.insert(s.statuses).values({ id: newId("status"), workspaceId: wsA, category: "waiting_on_us", name: "Another", isDefault: true })), /duplicate key/);
    await expectPgError(inA((tx) => tx.insert(s.statuses).values({ id: newId("status"), workspaceId: wsA, category: "waiting_on_us", name: "open" })), /duplicate key/);
  });

  it("gen_ulid() produces valid, unique, time-ordered ids", async () => {
    const { rows } = await app.pool.query("SELECT gen_ulid() AS id FROM generate_series(1, 200)");
    const ids = rows.map((r: { id: string }) => `sts_${r.id}`);
    expect(ids.every((id) => isId(id, "status"))).toBe(true);
    expect(new Set(ids).size).toBe(200);
    const now = Date.now();
    const { rows: [one] } = await app.pool.query("SELECT gen_ulid() AS id");
    const enc = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const ms = [...(one.id as string).slice(0, 10)].reduce((acc, ch) => acc * 32 + enc.indexOf(ch), 0);
    expect(Math.abs(ms - now)).toBeLessThan(5000);
  });
});

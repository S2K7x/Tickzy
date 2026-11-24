import { and, asc, count, eq, ilike, inArray, isNull, max, or, sql, type SQL } from "drizzle-orm";
import { AppError, newId, normalizeDomain, PUBLIC_EMAIL_DOMAINS } from "@tickzy/shared";
import { schema, withWorkspace, type Db, type Tx } from "@tickzy/db";
import type { MemberContext } from "../../http/auth.ts";
import { validateCustom, type FieldDef } from "../../lib/custom-fields.ts";
import { accountForEmail, mapContactsToDomains, normalizeIdentityKey, type IdentityKind } from "./resolution.ts";
import { pgMessage } from "../../lib/pg-errors.ts";

const OPEN_CATEGORIES = ["triage", "waiting_on_us", "waiting_on_customer", "blocked"] as const;
const PAGE_MAX = 100;

export interface AccountDto {
  id: string; name: string; domains: string[]; tier: string | null; owner_membership_id: string | null;
  external_ids: Record<string, string>; custom: Record<string, unknown>; contact_count: number; open_issue_count: number;
  /** Most recent change on any of the account's issues (null when it has none). */
  last_activity_at: string | null;
  created_at: string; updated_at: string;
}
export interface ContactDto {
  id: string; name: string; account_id: string | null; account_source: "auto" | "manual"; role_in_account: string | null;
  identities: { id: string; kind: IdentityKind; external_key: string }[]; custom: Record<string, unknown>; created_at: string; updated_at: string;
}
export interface AccountInput {
  name?: string | undefined; domains?: string[] | undefined; tier?: string | null | undefined; owner_membership_id?: string | null | undefined;
  external_ids?: Record<string, string> | undefined; custom?: Record<string, unknown> | undefined;
}
export interface ContactInput {
  name?: string | undefined; email?: string | undefined; account_id?: string | null | undefined; auto_account?: boolean | undefined;
  role_in_account?: string | null | undefined; custom?: Record<string, unknown> | undefined;
}

// Keyset cursor over (lower(name), id): opaque base64url JSON.
const encodeCursor = (name: string, id: string) => Buffer.from(JSON.stringify([name.toLowerCase(), id])).toString("base64url");
function decodeCursor(c: string | undefined): [string, string] | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "string")) return v as [string, string];
  } catch { /* fallthrough */ }
  throw new AppError("validation_failed", "Invalid cursor", [{ path: "cursor", issue: "invalid" }]);
}

async function audit(tx: Tx, ctx: MemberContext, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) {
  await tx.insert(schema.auditLog).values({ id: newId("auditLog"), workspaceId: ctx.workspaceId, actorType: ctx.actor.type, actorId: ctx.actor.id, action, targetType, targetId, metadata });
}

async function fieldDefs(tx: Tx, entity: "account" | "contact"): Promise<FieldDef[]> {
  return tx.select({ key: schema.customFieldDefs.key, type: schema.customFieldDefs.type, options: schema.customFieldDefs.options, required: schema.customFieldDefs.required, archivedAt: schema.customFieldDefs.archivedAt })
    .from(schema.customFieldDefs).where(eq(schema.customFieldDefs.entity, entity));
}

function cleanDomains(input: string[]): string[] {
  const out = new Set<string>();
  const issues: { path: string; issue: string }[] = [];
  input.forEach((raw, i) => {
    const d = normalizeDomain(raw);
    // Issues name the value so a UI can show them as-is ("gmail.com is a public email provider…").
    if (!d) issues.push({ path: `domains.${i}`, issue: `"${raw.slice(0, 80)}" is not a domain` });
    else if (PUBLIC_EMAIL_DOMAINS.has(d)) issues.push({ path: `domains.${i}`, issue: `${d} is a public email provider; it cannot identify one company` });
    else out.add(d);
  });
  if (issues.length) throw new AppError("validation_failed", "Invalid domains", issues);
  return [...out];
}

async function assertActiveMember(tx: Tx, membershipId: string | null | undefined) {
  if (!membershipId) return;
  const [m] = await tx.select({ status: schema.memberships.status }).from(schema.memberships).where(eq(schema.memberships.id, membershipId));
  if (!m || m.status !== "active") throw new AppError("validation_failed", "Owner must be an active member", [{ path: "owner_membership_id", issue: "not an active member" }]);
}

async function assertLiveAccount(tx: Tx, accountId: string) {
  const [a] = await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.id, accountId), isNull(schema.accounts.deletedAt)));
  if (!a) throw new AppError("validation_failed", "Unknown account", [{ path: "account_id", issue: "not found" }]);
}

export function createCustomersService(db: Db) {
  async function loadAccounts(tx: Tx, where: SQL | undefined, limit: number, after: [string, string] | null): Promise<AccountDto[]> {
    const keyset = after ? sql`(lower(${schema.accounts.name}), ${schema.accounts.id}) > (${after[0]}, ${after[1]})` : undefined;
    const rows = await tx.select().from(schema.accounts)
      .where(and(isNull(schema.accounts.deletedAt), where, keyset))
      .orderBy(asc(sql`lower(${schema.accounts.name})`), asc(schema.accounts.id))
      .limit(limit);
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const domains = await tx.select().from(schema.accountDomains).where(inArray(schema.accountDomains.accountId, ids)).orderBy(asc(schema.accountDomains.domain));
    const contacts = await tx.select({ id: schema.contacts.accountId, n: count() }).from(schema.contacts)
      .where(and(inArray(schema.contacts.accountId, ids), isNull(schema.contacts.deletedAt))).groupBy(schema.contacts.accountId);
    const open = await tx.select({ id: schema.issues.accountId, n: count() }).from(schema.issues)
      .where(and(inArray(schema.issues.accountId, ids), inArray(schema.issues.statusCategory, [...OPEN_CATEGORIES]))).groupBy(schema.issues.accountId);
    const activity = await tx.select({ id: schema.issues.accountId, at: max(schema.issues.updatedAt) }).from(schema.issues)
      .where(inArray(schema.issues.accountId, ids)).groupBy(schema.issues.accountId);
    const lastActivity = new Map(activity.map((c) => [c.id, c.at]));
    const nContacts = new Map(contacts.map((c) => [c.id, c.n]));
    const nOpen = new Map(open.map((c) => [c.id, c.n]));
    return rows.map((a) => ({
      id: a.id, name: a.name, domains: domains.filter((d) => d.accountId === a.id).map((d) => d.domain), tier: a.tier,
      owner_membership_id: a.ownerMembershipId, external_ids: a.externalIds, custom: a.custom,
      contact_count: nContacts.get(a.id) ?? 0, open_issue_count: nOpen.get(a.id) ?? 0,
      last_activity_at: lastActivity.get(a.id)?.toISOString() ?? null,
      created_at: a.createdAt.toISOString(), updated_at: a.updatedAt.toISOString(),
    }));
  }

  async function getAccountTx(tx: Tx, id: string): Promise<AccountDto> {
    const [a] = await loadAccounts(tx, eq(schema.accounts.id, id), 1, null);
    if (!a) throw new AppError("not_found", "Account not found");
    return a;
  }

  async function setDomains(tx: Tx, ctx: MemberContext, accountId: string, domains: string[]): Promise<string[]> {
    const current = (await tx.select().from(schema.accountDomains).where(eq(schema.accountDomains.accountId, accountId))).map((d) => d.domain);
    const removed = current.filter((d) => !domains.includes(d));
    const added = domains.filter((d) => !current.includes(d));
    if (removed.length) await tx.delete(schema.accountDomains).where(and(eq(schema.accountDomains.accountId, accountId), inArray(schema.accountDomains.domain, removed)));
    for (const domain of added) {
      try {
        await tx.insert(schema.accountDomains).values({ workspaceId: ctx.workspaceId, domain, accountId });
      } catch (err) {
        if (pgMessage(err).includes("account_domains_pkey")) throw new AppError("conflict", `${domain} already belongs to another account`);
        throw err;
      }
    }
    return added;
  }

  async function loadContacts(tx: Tx, where: SQL | undefined, limit: number, after: [string, string] | null): Promise<ContactDto[]> {
    const keyset = after ? sql`(lower(${schema.contacts.name}), ${schema.contacts.id}) > (${after[0]}, ${after[1]})` : undefined;
    const rows = await tx.select().from(schema.contacts)
      .where(and(isNull(schema.contacts.deletedAt), where, keyset))
      .orderBy(asc(sql`lower(${schema.contacts.name})`), asc(schema.contacts.id)).limit(limit);
    if (rows.length === 0) return [];
    const idents = await tx.select().from(schema.contactIdentities).where(inArray(schema.contactIdentities.contactId, rows.map((r) => r.id))).orderBy(asc(schema.contactIdentities.createdAt));
    return rows.map((c) => ({
      id: c.id, name: c.name, account_id: c.accountId, account_source: c.accountSource, role_in_account: c.roleInAccount,
      identities: idents.filter((i) => i.contactId === c.id).map((i) => ({ id: i.id, kind: i.kind, external_key: i.externalKey })),
      custom: c.custom, created_at: c.createdAt.toISOString(), updated_at: c.updatedAt.toISOString(),
    }));
  }
  async function getContactTx(tx: Tx, id: string): Promise<ContactDto> {
    const [c] = await loadContacts(tx, eq(schema.contacts.id, id), 1, null);
    if (!c) throw new AppError("not_found", "Contact not found");
    return c;
  }

  return {
    async listAccounts(ctx: MemberContext, q: { q?: string | undefined; cursor?: string | undefined; limit?: number | undefined }) {
      const limit = Math.min(q.limit ?? 50, PAGE_MAX);
      return withWorkspace(db, ctx, async (tx) => {
        const term = q.q?.trim();
        const where = term
          ? or(ilike(schema.accounts.name, `%${term.replace(/[%_\\]/g, "\\$&")}%`),
              sql`EXISTS (SELECT 1 FROM account_domains d WHERE d.account_id = ${schema.accounts.id} AND d.domain LIKE ${`${term.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`})`)
          : undefined;
        const data = await loadAccounts(tx, where, limit + 1, decodeCursor(q.cursor));
        const page = data.slice(0, limit);
        const last = page.at(-1);
        return { data: page, next_cursor: data.length > limit && last ? encodeCursor(last.name, last.id) : null };
      });
    },

    getAccount: (ctx: MemberContext, id: string) => withWorkspace(db, ctx, (tx) => getAccountTx(tx, id)),

    async createAccount(ctx: MemberContext, input: AccountInput & { name: string }): Promise<AccountDto> {
      return withWorkspace(db, ctx, async (tx) => {
        const domains = cleanDomains(input.domains ?? []);
        await assertActiveMember(tx, input.owner_membership_id);
        const custom = validateCustom(await fieldDefs(tx, "account"), {}, input.custom);
        const id = newId("account");
        await tx.insert(schema.accounts).values({
          id, workspaceId: ctx.workspaceId, name: input.name, tier: input.tier ?? null, ownerMembershipId: input.owner_membership_id ?? null,
          externalIds: input.external_ids ?? {}, custom,
        });
        await setDomains(tx, ctx, id, domains);
        const mapped = await mapContactsToDomains(tx, id, domains);
        await audit(tx, ctx, "account.created", "account", id, { name: input.name, domains, contacts_mapped: mapped });
        await tx.insert(schema.outbox).values({ workspaceId: ctx.workspaceId, type: "account.created", payload: { account_id: id } });
        return getAccountTx(tx, id);
      });
    },

    async updateAccount(ctx: MemberContext, id: string, input: AccountInput): Promise<AccountDto> {
      return withWorkspace(db, ctx, async (tx) => {
        const [current] = await tx.select().from(schema.accounts).where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt))).for("update");
        if (!current) throw new AppError("not_found", "Account not found");
        if (input.owner_membership_id !== undefined) await assertActiveMember(tx, input.owner_membership_id);
        const values: Partial<typeof schema.accounts.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) values.name = input.name;
        if (input.tier !== undefined) values.tier = input.tier;
        if (input.owner_membership_id !== undefined) values.ownerMembershipId = input.owner_membership_id;
        if (input.external_ids !== undefined) values.externalIds = input.external_ids;
        if (input.custom !== undefined) values.custom = validateCustom(await fieldDefs(tx, "account"), current.custom, input.custom);
        await tx.update(schema.accounts).set(values).where(eq(schema.accounts.id, id));
        let mapped = 0;
        if (input.domains !== undefined) mapped = await mapContactsToDomains(tx, id, await setDomains(tx, ctx, id, cleanDomains(input.domains)));
        await audit(tx, ctx, "account.updated", "account", id, { fields: Object.keys(input).filter((k) => input[k as keyof AccountInput] !== undefined), contacts_mapped: mapped });
        await tx.insert(schema.outbox).values({ workspaceId: ctx.workspaceId, type: "account.updated", payload: { account_id: id } });
        return getAccountTx(tx, id);
      });
    },

    /** Soft delete: the account disappears from lists, its domains are released, its contacts become unassigned. Issues keep their history. */
    async deleteAccount(ctx: MemberContext, id: string): Promise<void> {
      await withWorkspace(db, ctx, async (tx) => {
        const res = await tx.update(schema.accounts).set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt))).returning({ name: schema.accounts.name });
        if (res.length === 0) throw new AppError("not_found", "Account not found");
        await tx.delete(schema.accountDomains).where(eq(schema.accountDomains.accountId, id));
        await tx.update(schema.contacts).set({ accountId: null, accountSource: "auto", updatedAt: new Date() }).where(eq(schema.contacts.accountId, id));
        await audit(tx, ctx, "account.deleted", "account", id, { name: res[0]!.name });
        await tx.insert(schema.outbox).values({ workspaceId: ctx.workspaceId, type: "account.deleted", payload: { account_id: id } });
      });
    },

    async listContacts(ctx: MemberContext, q: { account_id?: string | undefined; q?: string | undefined; cursor?: string | undefined; limit?: number | undefined }) {
      const limit = Math.min(q.limit ?? 50, PAGE_MAX);
      return withWorkspace(db, ctx, async (tx) => {
        const term = q.q?.trim().toLowerCase().replace(/[%_\\]/g, "\\$&");
        const where = and(
          q.account_id ? eq(schema.contacts.accountId, q.account_id) : undefined,
          term ? or(ilike(schema.contacts.name, `%${term}%`), sql`EXISTS (SELECT 1 FROM contact_identities i WHERE i.contact_id = ${schema.contacts.id} AND i.external_key LIKE ${`%${term}%`})`) : undefined,
        );
        const data = await loadContacts(tx, where, limit + 1, decodeCursor(q.cursor));
        const page = data.slice(0, limit);
        const last = page.at(-1);
        return { data: page, next_cursor: data.length > limit && last ? encodeCursor(last.name, last.id) : null };
      });
    },

    getContact: (ctx: MemberContext, id: string) => withWorkspace(db, ctx, (tx) => getContactTx(tx, id)),

    async createContact(ctx: MemberContext, input: ContactInput): Promise<ContactDto> {
      return withWorkspace(db, ctx, async (tx) => {
        const email = input.email ? normalizeIdentityKey("email", input.email) : null;
        if (email) {
          const [taken] = await tx.select({ contactId: schema.contactIdentities.contactId }).from(schema.contactIdentities)
            .where(and(eq(schema.contactIdentities.kind, "email"), eq(schema.contactIdentities.externalKey, email)));
          if (taken) throw new AppError("conflict", `A contact with ${email} already exists (${taken.contactId})`);
        }
        let accountId: string | null = null;
        let source: "auto" | "manual" = "auto";
        if (input.account_id) { await assertLiveAccount(tx, input.account_id); accountId = input.account_id; source = "manual"; }
        else if (input.account_id === null) source = "manual";
        else if (email) accountId = await accountForEmail(tx, email);
        const custom = validateCustom(await fieldDefs(tx, "contact"), {}, input.custom);
        const id = newId("contact");
        await tx.insert(schema.contacts).values({ id, workspaceId: ctx.workspaceId, name: input.name ?? "", accountId, accountSource: source, roleInAccount: input.role_in_account ?? null, custom });
        if (email) await tx.insert(schema.contactIdentities).values({ id: newId("contactIdentity"), workspaceId: ctx.workspaceId, contactId: id, kind: "email", externalKey: email });
        await audit(tx, ctx, "contact.created", "contact", id, { account_id: accountId, account_source: source });
        return getContactTx(tx, id);
      });
    },

    async updateContact(ctx: MemberContext, id: string, input: ContactInput): Promise<ContactDto> {
      return withWorkspace(db, ctx, async (tx) => {
        const [current] = await tx.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt))).for("update");
        if (!current) throw new AppError("not_found", "Contact not found");
        const values: Partial<typeof schema.contacts.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) values.name = input.name;
        if (input.role_in_account !== undefined) values.roleInAccount = input.role_in_account;
        if (input.custom !== undefined) values.custom = validateCustom(await fieldDefs(tx, "contact"), current.custom, input.custom);
        if (input.auto_account) {
          // Hand the contact back to automatic mapping and re-resolve from its email identities now.
          const emails = await tx.select({ key: schema.contactIdentities.externalKey }).from(schema.contactIdentities)
            .where(and(eq(schema.contactIdentities.contactId, id), eq(schema.contactIdentities.kind, "email")));
          let auto: string | null = null;
          for (const e of emails) { auto = await accountForEmail(tx, e.key); if (auto) break; }
          values.accountId = auto;
          values.accountSource = "auto";
        } else if (input.account_id !== undefined) {
          if (input.account_id) await assertLiveAccount(tx, input.account_id);
          values.accountId = input.account_id;
          values.accountSource = "manual";
        }
        await tx.update(schema.contacts).set(values).where(eq(schema.contacts.id, id));
        const accountChanged = ("accountId" in values && values.accountId !== current.accountId) || ("accountSource" in values && values.accountSource !== current.accountSource);
        if (accountChanged) {
          await audit(tx, ctx, "contact.account_changed", "contact", id, {
            from: { account_id: current.accountId, source: current.accountSource }, to: { account_id: values.accountId ?? null, source: values.accountSource },
          });
        }
        return getContactTx(tx, id);
      });
    },

    async deleteContact(ctx: MemberContext, id: string): Promise<void> {
      await withWorkspace(db, ctx, async (tx) => {
        const res = await tx.update(schema.contacts).set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt))).returning({ id: schema.contacts.id });
        if (res.length === 0) throw new AppError("not_found", "Contact not found");
        // Free its identities so the person is recognised afresh if they write in again.
        await tx.delete(schema.contactIdentities).where(eq(schema.contactIdentities.contactId, id));
        await audit(tx, ctx, "contact.deleted", "contact", id, {});
      });
    },

    async addIdentity(ctx: MemberContext, contactId: string, input: { kind: IdentityKind; external_key: string }): Promise<ContactDto> {
      return withWorkspace(db, ctx, async (tx) => {
        await getContactTx(tx, contactId);
        const key = normalizeIdentityKey(input.kind, input.external_key);
        const inserted = await tx.insert(schema.contactIdentities).values({ id: newId("contactIdentity"), workspaceId: ctx.workspaceId, contactId, kind: input.kind, externalKey: key })
          .onConflictDoNothing().returning({ id: schema.contactIdentities.id });
        if (inserted.length === 0) throw new AppError("conflict", "This identity already belongs to a contact");
        await audit(tx, ctx, "contact.identity_added", "contact", contactId, { kind: input.kind });
        return getContactTx(tx, contactId);
      });
    },

    async removeIdentity(ctx: MemberContext, contactId: string, identityId: string): Promise<ContactDto> {
      return withWorkspace(db, ctx, async (tx) => {
        const res = await tx.delete(schema.contactIdentities)
          .where(and(eq(schema.contactIdentities.id, identityId), eq(schema.contactIdentities.contactId, contactId))).returning({ kind: schema.contactIdentities.kind });
        if (res.length === 0) throw new AppError("not_found", "Identity not found");
        await audit(tx, ctx, "contact.identity_removed", "contact", contactId, { kind: res[0]!.kind });
        return getContactTx(tx, contactId);
      });
    },
  };
}

import { and, eq, isNull, sql } from "drizzle-orm";
import { companyDomainOf, newId } from "@tickzy/shared";
import { schema, type Tx } from "@tickzy/db";

/**
 * Identity resolution (FR-4.2): who is behind an inbound message, and which account do they belong to.
 * Used by channel ingestion (M3) and the contacts API. Runs inside the caller's tenant transaction.
 *
 * Account precedence for a NEW contact: endpoint default account (e.g. a Slack Connect channel mapped to Globex)
 * > company email domain (never public providers) > none. Existing contacts keep their account; an
 * `account_source = 'manual'` choice is never changed automatically.
 */
export type IdentityKind = "email" | "slack" | "teams" | "widget";

export const normalizeIdentityKey = (kind: IdentityKind, key: string) => (kind === "email" ? key.trim().toLowerCase() : key.trim());

/** The live (not deleted) account owning a company email domain, if any. */
export async function accountForEmail(tx: Tx, email: string): Promise<string | null> {
  const domain = companyDomainOf(email);
  if (!domain) return null;
  const [row] = await tx
    .select({ id: schema.accounts.id })
    .from(schema.accountDomains)
    .innerJoin(schema.accounts, and(eq(schema.accounts.id, schema.accountDomains.accountId), isNull(schema.accounts.deletedAt)))
    .where(eq(schema.accountDomains.domain, domain));
  return row?.id ?? null;
}

export interface ResolveInput {
  kind: IdentityKind;
  externalKey: string;
  name?: string | undefined;
  /** The channel endpoint's default account, when the conversation happens in an account-specific place. */
  defaultAccountId?: string | null | undefined;
  /** False when the identity is not proven (unverified email sender): no account mapping by email domain. */
  trustDomain?: boolean | undefined;
}

export async function resolveContact(tx: Tx, workspaceId: string, input: ResolveInput): Promise<{ contactId: string; accountId: string | null; created: boolean }> {
  const key = normalizeIdentityKey(input.kind, input.externalKey);
  const existing = await findByIdentity(tx, input.kind, key);
  if (existing) {
    // Fill a missing automatic account (e.g. the domain was added to an account after the contact first wrote in).
    if (!existing.accountId && existing.accountSource === "auto") {
      const accountId = input.defaultAccountId ?? (input.kind === "email" && input.trustDomain !== false ? await accountForEmail(tx, key) : null);
      if (accountId) {
        await tx.update(schema.contacts).set({ accountId, updatedAt: new Date() }).where(eq(schema.contacts.id, existing.id));
        return { contactId: existing.id, accountId, created: false };
      }
    }
    return { contactId: existing.id, accountId: existing.accountId, created: false };
  }
  // An unverified email sender (threat model TM-6) is never placed into an account by its claimed domain.
  const accountId = input.defaultAccountId ?? (input.kind === "email" && input.trustDomain !== false ? await accountForEmail(tx, key) : null);
  const contactId = newId("contact");
  await tx.insert(schema.contacts).values({ id: contactId, workspaceId, accountId, accountSource: "auto", name: input.name?.slice(0, 200) ?? "" });
  const inserted = await tx.insert(schema.contactIdentities)
    .values({ id: newId("contactIdentity"), workspaceId, contactId, kind: input.kind, externalKey: key })
    .onConflictDoNothing()
    .returning({ id: schema.contactIdentities.id });
  if (inserted.length === 0) {
    // Lost a race with a concurrent first message from the same person: use theirs, drop ours.
    await tx.delete(schema.contacts).where(eq(schema.contacts.id, contactId)).catch(() => undefined);
    const winner = (await findByIdentity(tx, input.kind, key))!;
    return { contactId: winner.id, accountId: winner.accountId, created: false };
  }
  return { contactId, accountId, created: true };
}

async function findByIdentity(tx: Tx, kind: IdentityKind, key: string) {
  const [row] = await tx
    .select({ id: schema.contacts.id, accountId: schema.contacts.accountId, accountSource: schema.contacts.accountSource })
    .from(schema.contactIdentities)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.contactIdentities.contactId))
    .where(and(eq(schema.contactIdentities.kind, kind), eq(schema.contactIdentities.externalKey, key)));
  return row;
}

/** After domains are added to an account: attach unassigned, automatically-mapped contacts with those email domains. */
export async function mapContactsToDomains(tx: Tx, accountId: string, domains: string[]): Promise<number> {
  if (domains.length === 0) return 0;
  const res = await tx.execute(sql`
    UPDATE contacts c SET account_id = ${accountId}, updated_at = now()
    WHERE c.account_id IS NULL AND c.account_source = 'auto' AND c.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM contact_identities i WHERE i.contact_id = c.id AND i.kind = 'email'
                  AND split_part(i.external_key, '@', 2) IN (${sql.join(domains.map((d) => sql`${d}`), sql`, `)}))`);
  return res.rowCount ?? 0;
}

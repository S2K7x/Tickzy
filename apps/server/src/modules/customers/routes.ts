import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@tickzy/db";
import { requireMember, WorkspaceHeader } from "../../http/auth.ts";
import { createCustomersService } from "./service.ts";

const Id = z.object({ id: z.string().max(64) });
const Custom = z.record(z.string().max(40), z.unknown());
const Page = { cursor: z.string().max(500).optional(), limit: z.coerce.number().int().min(1).max(100).optional() };
const Account = z.object({
  id: z.string(), name: z.string(), domains: z.array(z.string()), tier: z.string().nullable(), owner_membership_id: z.string().nullable(),
  external_ids: z.record(z.string(), z.string()), custom: z.record(z.string(), z.unknown()), contact_count: z.number(), open_issue_count: z.number(), last_activity_at: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
});
const Identity = z.object({ id: z.string(), kind: z.enum(["email", "slack", "teams", "widget"]), external_key: z.string() });
const Contact = z.object({
  id: z.string(), name: z.string(), account_id: z.string().nullable(), account_source: z.enum(["auto", "manual"]), role_in_account: z.string().nullable(),
  identities: z.array(Identity), custom: z.record(z.string(), z.unknown()), created_at: z.string(), updated_at: z.string(),
});
const AccountFields = {
  name: z.string().trim().min(1).max(200),
  domains: z.array(z.string().max(253)).max(50).optional(),
  tier: z.string().trim().min(1).max(40).nullable().optional(),
  owner_membership_id: z.string().max(64).nullable().optional(),
  external_ids: z.record(z.string().max(40), z.string().max(200)).optional(),
  custom: Custom.optional(),
};

/** Accounts & contacts (FR-4.1, FR-4.2, T-203). Read: any member or token; write: accounts:write. */
export function customerRoutes(db: Db) {
  const service = createCustomersService(db);
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.get("/v1/accounts", {
      schema: {
        tags: ["accounts"], summary: "Accounts, sorted by name (keyset pagination); `q` matches name or domain prefix", headers: WorkspaceHeader,
        querystring: z.object({ q: z.string().max(100).optional(), ...Page }), response: { 200: z.object({ data: z.array(Account), next_cursor: z.string().nullable() }) },
      },
    }, async (req) => service.listAccounts(await requireMember(db, req), req.query));

    r.post("/v1/accounts", {
      schema: { tags: ["accounts"], summary: "Create an account", headers: WorkspaceHeader, body: z.object(AccountFields), response: { 201: Account } },
    }, async (req, reply) => reply.code(201).send(await service.createAccount(await requireMember(db, req, "accounts:write"), req.body)));

    r.get("/v1/accounts/:id", {
      schema: { tags: ["accounts"], summary: "One account", headers: WorkspaceHeader, params: Id, response: { 200: Account } },
    }, async (req) => service.getAccount(await requireMember(db, req), req.params.id));

    r.patch("/v1/accounts/:id", {
      schema: {
        tags: ["accounts"], summary: "Update an account (`domains` replaces the set; new domains attach matching unassigned contacts)", headers: WorkspaceHeader, params: Id,
        body: z.object({ ...AccountFields, name: AccountFields.name.optional() }).refine((b) => Object.keys(b).length > 0, "empty patch"), response: { 200: Account },
      },
    }, async (req) => service.updateAccount(await requireMember(db, req, "accounts:write"), req.params.id, req.body));

    r.delete("/v1/accounts/:id", {
      schema: { tags: ["accounts"], summary: "Delete an account (soft; releases its domains; issues keep history)", headers: WorkspaceHeader, params: Id },
    }, async (req, reply) => {
      await service.deleteAccount(await requireMember(db, req, "accounts:write"), req.params.id);
      return reply.code(204).send();
    });

    r.get("/v1/contacts", {
      schema: {
        tags: ["contacts"], summary: "Contacts, sorted by name; filter by account or search name/identity", headers: WorkspaceHeader,
        querystring: z.object({ account_id: z.string().max(64).optional(), q: z.string().max(100).optional(), ...Page }),
        response: { 200: z.object({ data: z.array(Contact), next_cursor: z.string().nullable() }) },
      },
    }, async (req) => service.listContacts(await requireMember(db, req), req.query));

    r.post("/v1/contacts", {
      schema: {
        tags: ["contacts"], summary: "Create a contact (an email adds an email identity; account auto-mapped from its domain unless given)", headers: WorkspaceHeader,
        body: z.object({
          name: z.string().trim().max(200).optional(), email: z.email().max(254).optional(), account_id: z.string().max(64).nullable().optional(),
          role_in_account: z.string().trim().max(80).nullable().optional(), custom: Custom.optional(),
        }),
        response: { 201: Contact },
      },
    }, async (req, reply) => reply.code(201).send(await service.createContact(await requireMember(db, req, "accounts:write"), req.body)));

    r.get("/v1/contacts/:id", {
      schema: { tags: ["contacts"], summary: "One contact with its identities", headers: WorkspaceHeader, params: Id, response: { 200: Contact } },
    }, async (req) => service.getContact(await requireMember(db, req), req.params.id));

    r.patch("/v1/contacts/:id", {
      schema: {
        tags: ["contacts"], summary: "Update a contact. Setting account_id is a manual override (audited, never changed automatically); auto_account: true hands it back to auto-mapping",
        headers: WorkspaceHeader, params: Id,
        body: z.object({
          name: z.string().trim().max(200).optional(), account_id: z.string().max(64).nullable().optional(), auto_account: z.literal(true).optional(),
          role_in_account: z.string().trim().max(80).nullable().optional(), custom: Custom.optional(),
        }).refine((b) => Object.keys(b).length > 0, "empty patch").refine((b) => !(b.auto_account && b.account_id !== undefined), "use either account_id or auto_account"),
        response: { 200: Contact },
      },
    }, async (req) => service.updateContact(await requireMember(db, req, "accounts:write"), req.params.id, req.body));

    r.delete("/v1/contacts/:id", {
      schema: { tags: ["contacts"], summary: "Delete a contact (soft; frees its identities)", headers: WorkspaceHeader, params: Id },
    }, async (req, reply) => {
      await service.deleteContact(await requireMember(db, req, "accounts:write"), req.params.id);
      return reply.code(204).send();
    });

    r.post("/v1/contacts/:id/identities", {
      schema: { tags: ["contacts"], summary: "Link another identity (email, Slack `team:user`, …) to a contact", headers: WorkspaceHeader, params: Id,
        body: z.object({ kind: z.enum(["email", "slack", "teams", "widget"]), external_key: z.string().trim().min(1).max(320) }), response: { 200: Contact } },
    }, async (req) => service.addIdentity(await requireMember(db, req, "accounts:write"), req.params.id, req.body));

    r.delete("/v1/contacts/:id/identities/:identityId", {
      schema: { tags: ["contacts"], summary: "Unlink an identity from a contact", headers: WorkspaceHeader, params: Id.extend({ identityId: z.string().max(64) }), response: { 200: Contact } },
    }, async (req) => service.removeIdentity(await requireMember(db, req, "accounts:write"), req.params.id, req.params.identityId));
  };
}

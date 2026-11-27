import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@tickzy/db";
import { requireMember, WorkspaceHeader } from "../../http/auth.ts";
import { createEmailAddressService } from "./service.ts";

const TYPES = ["customer", "community", "internal", "triage"] as const;
const Address = z.object({
  id: z.string(), address: z.string(), name: z.string(), endpoint_type: z.enum(TYPES), default_account_id: z.string().nullable(),
  status: z.enum(["active", "disabled"]), created_at: z.string(),
});

/** Forwarding addresses for inbound email (T-302a). Admins only (channels:manage). */
export function emailRoutes(db: Db, opts: { inboundDomain: string | undefined }) {
  const service = createEmailAddressService(db, opts.inboundDomain);
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.get("/v1/channels/email/addresses", {
      schema: { tags: ["channels"], summary: "Forwarding addresses; `inbound_domain` is null when inbound email is not configured", headers: WorkspaceHeader,
        response: { 200: z.object({ inbound_domain: z.string().nullable(), data: z.array(Address) }) } },
    }, async (req) => service.list(await requireMember(db, req, "channels:manage")));
    r.post("/v1/channels/email/addresses", {
      schema: { tags: ["channels"], summary: "Create a forwarding address (409 when inbound email is not configured)", headers: WorkspaceHeader,
        body: z.object({ name: z.string().trim().min(1).max(200), endpoint_type: z.enum(TYPES).optional(), default_account_id: z.string().max(64).nullable().optional() }).strict(),
        response: { 201: Address } },
    }, async (req, reply) => reply.code(201).send(await service.create(await requireMember(db, req, "channels:manage"), req.body)));
    r.patch("/v1/channels/email/addresses/:id", {
      schema: { tags: ["channels"], summary: "Rename, retype, map to an account, disable or re-enable", headers: WorkspaceHeader, params: z.object({ id: z.string().max(64) }),
        body: z.object({ name: z.string().trim().min(1).max(200).optional(), endpoint_type: z.enum(TYPES).optional(), default_account_id: z.string().max(64).nullable().optional(), status: z.enum(["active", "disabled"]).optional() })
          .strict().refine((b) => Object.keys(b).length > 0, "empty patch"),
        response: { 200: Address } },
    }, async (req) => service.update(await requireMember(db, req, "channels:manage"), req.params.id, req.body));
  };
}

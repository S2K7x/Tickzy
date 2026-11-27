import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CHANNEL_KINDS, type Db } from "@tickzy/db";
import { requireMember, WorkspaceHeader } from "../../http/auth.ts";
import type { DeliveryRegistry } from "./delivery.ts";
import { createMessagesService } from "./service.ts";

const Message = z.object({
  id: z.string(), issue_id: z.string().nullable(), conversation_id: z.string(),
  visibility: z.enum(["public", "internal"]), direction: z.enum(["in", "out"]),
  author: z.object({ type: z.enum(["contact", "member", "ai", "system"]), id: z.string().nullable(), name: z.string().nullable() }),
  body: z.object({ text: z.string(), ast: z.unknown() }), source: z.enum(CHANNEL_KINDS),
  delivery_state: z.enum(["pending", "sent", "failed", "received"]).nullable(), attachments: z.array(z.never()), created_at: z.string(),
});

/** Messages API (T-205): replies (public) need issues:reply, internal notes need issues:note (api-spec §2). */
export function messageRoutes(db: Db, channels: DeliveryRegistry) {
  const service = createMessagesService(db, channels);
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();

    // Which channels can actually deliver a reply right now (an adapter is registered, ADR-026). The app uses it to
    // say honestly when a reply is only saved (e.g. email before outbound email exists).
    r.get("/v1/channels/delivery", {
      schema: { tags: ["channels"], summary: "Channels whose replies are delivered to the customer", headers: WorkspaceHeader,
        response: { 200: z.object({ deliverable: z.array(z.enum(["slack", "email", "widget"])) }) } },
    }, async (req) => {
      await requireMember(db, req, "issues:read");
      return { deliverable: (["slack", "email", "widget"] as const).filter((k) => channels.adapterFor(k) !== null) };
    });

    r.post("/v1/issues/:ref/messages", {
      schema: {
        tags: ["messages"], summary: "Reply to the customer (`public`) or add an internal note (`internal`, never sent to the customer)",
        headers: WorkspaceHeader, params: z.object({ ref: z.string().max(64) }),
        body: z.object({ body: z.string().trim().min(1).max(50_000), visibility: z.enum(["public", "internal"]) }),
        response: { 201: Message },
      },
    }, async (req, reply) => {
      const m = await requireMember(db, req, req.body.visibility === "public" ? "issues:reply" : "issues:note");
      return reply.code(201).send(await service.post(m, req.params.ref, req.body));
    });

    r.post("/v1/messages/:id/retry", {
      schema: {
        tags: ["messages"], summary: "Re-send a message whose delivery failed", headers: WorkspaceHeader,
        params: z.object({ id: z.string().max(64) }), response: { 200: Message },
      },
    }, async (req) => service.retry(await requireMember(db, req, "issues:reply"), req.params.id));
  };
}

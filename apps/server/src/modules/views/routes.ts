import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { PRIORITIES, SYSTEM_VIEW_IDS, VIEW_SORTS } from "@tickzy/shared";
import { CHANNEL_KINDS, type Db } from "@tickzy/db";
import { requireMember, WorkspaceHeader } from "../../http/auth.ts";
import { csv } from "../issues/routes.ts";
import { createViewsService } from "./service.ts";

const Id = z.object({ id: z.string().max(64) });
const Id64 = z.string().max(64);
/** Filters are validated like the GET /v1/issues query, but stored as the URL's comma lists. */
const Filters = z.object({
  priority: csv(PRIORITIES).transform((a) => a.join(",")).optional(),
  channel: csv(CHANNEL_KINDS).transform((a) => a.join(",")).optional(),
  team: Id64.optional(), label: Id64.optional(), account: Id64.optional(),
  q: z.string().trim().max(200).optional(),
}).strict();
const View = z.object({
  id: z.string(), name: z.string(), shared: z.boolean(), base: z.enum(SYSTEM_VIEW_IDS), sort: z.enum(VIEW_SORTS), position: z.number(),
  filters: z.object({ priority: z.string().optional(), channel: z.string().optional(), team: z.string().optional(), label: z.string().optional(), account: z.string().optional(), q: z.string().optional() }),
  owner_user_id: z.string(), owner_name: z.string().nullable(), count: z.number(), can_edit: z.boolean(), created_at: z.string(), updated_at: z.string(),
});
const Fields = {
  name: z.string().trim().min(1).max(60),
  shared: z.boolean().optional(),
  base: z.enum(SYSTEM_VIEW_IDS),
  filters: Filters.optional(),
  sort: z.enum(VIEW_SORTS).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
};

/** Saved views (T-211, FR-3.7): signed-in members only (API tokens get 403). */
export function viewRoutes(db: Db) {
  const service = createViewsService(db);
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.get("/v1/views", {
      schema: { tags: ["views"], summary: "Your personal views, then shared ones, each with its live issue count", headers: WorkspaceHeader, response: { 200: z.object({ data: z.array(View) }) } },
    }, async (req) => service.list(await requireMember(db, req, "issues:read")));
    r.post("/v1/views", {
      schema: { tags: ["views"], summary: "Save a view (shared: true needs issues:write); 409 on a duplicate name", headers: WorkspaceHeader, body: z.object(Fields), response: { 201: View } },
    }, async (req, reply) => reply.code(201).send(await service.create(await requireMember(db, req, "issues:read"), req.body)));
    r.get("/v1/views/:id", {
      schema: { tags: ["views"], summary: "One view (404 if it is someone else's personal view)", headers: WorkspaceHeader, params: Id, response: { 200: View } },
    }, async (req) => service.get(await requireMember(db, req, "issues:read"), req.params.id));
    r.patch("/v1/views/:id", {
      schema: {
        tags: ["views"], summary: "Rename, re-filter, reorder, share or unshare (owner or admin)", headers: WorkspaceHeader, params: Id,
        body: z.object({ ...Fields, name: Fields.name.optional(), base: Fields.base.optional() }).refine((b) => Object.keys(b).length > 0, "empty patch"),
        response: { 200: View },
      },
    }, async (req) => service.update(await requireMember(db, req, "issues:read"), req.params.id, req.body));
    r.delete("/v1/views/:id", {
      schema: { tags: ["views"], summary: "Delete a view (owner or admin)", headers: WorkspaceHeader, params: Id },
    }, async (req, reply) => { await service.remove(await requireMember(db, req, "issues:read"), req.params.id); return reply.code(204).send(); });
  };
}

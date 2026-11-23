import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@tickzy/db";
import { requireMember, requireUser, WorkspaceHeader } from "../../http/auth.ts";
import { createWorkspaceService } from "./service.ts";

const Workspace = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  issue_prefix: z.string(),
  region: z.enum(["us", "eu"]),
  created_at: z.string(),
});
const Name = z.string().trim().min(1).max(80);
const Slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3–40 chars: lowercase letters, digits, hyphens");
const Prefix = z.string().regex(/^[A-Z]{2,5}$/, "2–5 uppercase letters");

export function workspaceRoutes(db: Db) {
  const service = createWorkspaceService(db);
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.post("/v1/workspaces", {
      schema: {
        tags: ["workspaces"],
        summary: "Create a workspace; the caller becomes its admin",
        body: z.object({ name: Name, slug: Slug, issue_prefix: Prefix }),
        response: { 201: Workspace },
      },
    }, async (req, reply) => {
      const user = requireUser(req);
      const ws = await service.create(user.userId, req.body);
      return reply.code(201).send(ws);
    });

    r.get("/v1/workspaces/current", {
      schema: { tags: ["workspaces"], summary: "The workspace named by the Tickzy-Workspace header", headers: WorkspaceHeader, response: { 200: Workspace } },
    }, async (req) => {
      const m = await requireMember(db, req);
      return service.get(m);
    });

    r.patch("/v1/workspaces/current", {
      schema: {
        tags: ["workspaces"],
        summary: "Update workspace settings",
        headers: WorkspaceHeader,
        body: z.object({ name: Name.optional(), issue_prefix: Prefix.optional() }).refine((b) => Object.keys(b).length > 0, "empty patch"),
        response: { 200: Workspace },
      },
    }, async (req) => {
      const m = await requireMember(db, req, "workspace:manage");
      return service.update(m, req.body);
    });

    r.get("/v1/me/workspaces", {
      schema: {
        tags: ["workspaces"],
        summary: "Workspaces the caller belongs to",
        response: { 200: z.object({ data: z.array(z.object({ workspace_id: z.string(), name: z.string(), slug: z.string(), role: z.string() })) }) },
      },
    }, async (req) => {
      const user = requireUser(req);
      return { data: await service.listMine(user.userId) };
    });
  };
}

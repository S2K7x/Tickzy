import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@tickzy/db";
import { requireMember, WorkspaceHeader } from "../../http/auth.ts";
import { createTaxonomyService } from "./service.ts";

const Label = z.object({ id: z.string(), name: z.string(), color: z.string(), description: z.string().nullable(), parent_id: z.string().nullable() });
const Team = z.object({ id: z.string(), name: z.string() });

export function taxonomyRoutes(db: Db) {
  const service = createTaxonomyService(db);
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.get("/v1/labels", {
      schema: { tags: ["taxonomy"], summary: "Active labels, by name", headers: WorkspaceHeader, response: { 200: z.object({ data: z.array(Label) }) } },
    }, async (req) => service.listLabels(await requireMember(db, req, "issues:read")));

    r.post("/v1/labels", {
      schema: {
        tags: ["taxonomy"], summary: "Create a label (anyone who can edit issues can label them); 409 if the name exists", headers: WorkspaceHeader,
        body: z.object({
          name: z.string().trim().min(1).max(60),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
          description: z.string().trim().max(500).nullable().optional(),
        }),
        response: { 201: Label },
      },
    }, async (req, reply) => reply.code(201).send(await service.createLabel(await requireMember(db, req, "issues:write"), req.body)));

    r.get("/v1/teams", {
      schema: { tags: ["taxonomy"], summary: "Active teams, by name", headers: WorkspaceHeader, response: { 200: z.object({ data: z.array(Team) }) } },
    }, async (req) => service.listTeams(await requireMember(db, req, "issues:read")));
  };
}

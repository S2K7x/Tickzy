import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@tickzy/db";
import { requireMember, WorkspaceHeader } from "../../http/auth.ts";
import { TOKEN_SCOPES } from "../../permissions.ts";
import type { ApiTokenService } from "./service.ts";

const ApiToken = z.object({
  id: z.string(), name: z.string(), prefix: z.string(), scopes: z.array(z.string()), created_by: z.string().nullable(),
  created_at: z.string(), expires_at: z.string().nullable(), last_used_at: z.string().nullable(),
});

export function apiTokenRoutes(db: Db, service: ApiTokenService) {
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.get("/v1/api-tokens", {
      schema: { tags: ["developers"], summary: "Active API tokens of the workspace (secrets are never returned)", headers: WorkspaceHeader, response: { 200: z.object({ data: z.array(ApiToken) }) } },
    }, async (req) => {
      const m = await requireMember(db, req, "developers:manage");
      return { data: await service.list(m) };
    });

    r.post("/v1/api-tokens", {
      schema: {
        tags: ["developers"],
        summary: "Create an API token. The token is returned once and cannot be retrieved again.",
        headers: WorkspaceHeader,
        body: z.object({
          name: z.string().trim().min(1).max(80),
          scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
          expires_in_days: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]),
        }),
        response: { 201: ApiToken.extend({ token: z.string() }) },
      },
    }, async (req, reply) => {
      const m = await requireMember(db, req, "developers:manage");
      return reply.code(201).send(await service.create(m, req.body));
    });

    r.delete("/v1/api-tokens/:id", {
      schema: { tags: ["developers"], summary: "Revoke an API token (takes effect immediately)", headers: WorkspaceHeader, params: z.object({ id: z.string().max(64) }) },
    }, async (req, reply) => {
      const m = await requireMember(db, req, "developers:manage");
      await service.revoke(m, req.params.id);
      return reply.code(204).send();
    });
  };
}

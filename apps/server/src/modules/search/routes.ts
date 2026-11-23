import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@tickzy/db";
import { requireMember, WorkspaceHeader } from "../../http/auth.ts";
import { createSearchService } from "./service.ts";
import { IssueSchema } from "../issues/routes.ts";

/** GET /v1/search (FR-3.8, T-207). Snippets mark matches with \u0001 … \u0002 (render as <mark>, never as HTML). */
export function searchRoutes(db: Db) {
  const service = createSearchService(db);
  return async function routes(app: FastifyInstance): Promise<void> {
    app.withTypeProvider<ZodTypeProvider>().get("/v1/search", {
      schema: {
        tags: ["search"],
        summary: "Full-text search across issues, messages and accounts with operators: from:, account:, status:, is:, channel:, priority:",
        headers: WorkspaceHeader,
        querystring: z.object({ q: z.string().max(500), limit: z.coerce.number().int().min(1).max(50).optional() }),
        response: { 200: z.object({
          query: z.object({ text: z.string(), filters: z.record(z.string(), z.array(z.string())) }),
          issues: z.array(z.object({ issue: IssueSchema, match: z.object({ in: z.enum(["title", "message", "filters"]), message_id: z.string().nullable(), snippet: z.string().nullable() }) })),
          accounts: z.array(z.object({ id: z.string(), name: z.string(), domains: z.array(z.string()) })),
        }) },
      },
    }, async (req) => service.search(await requireMember(db, req, "issues:read"), req.query.q, req.query.limit));
  };
}

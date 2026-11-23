import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { PRIORITIES, STATUS_CATEGORIES } from "@tickzy/shared";
import { CHANNEL_KINDS, type Db } from "@tickzy/db";
import { requireMember, WorkspaceHeader } from "../../http/auth.ts";
import { createIssuesService, SORTS } from "./service.ts";

const Ref = z.object({ ref: z.string().max(64) });
const Id64 = z.string().max(64);
/** Comma-separated list of enum values in a query string (`status=triage,waiting_on_us`). */
const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z.string().max(500).transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.enum(values)).max(values.length));

const Issue = z.object({
  id: z.string(), key: z.string(), number: z.number(), title: z.string(),
  status: z.object({ category: z.enum(STATUS_CATEGORIES), id: z.string(), name: z.string() }),
  priority: z.enum(PRIORITIES),
  assignee: z.object({ membership_id: z.string(), user_id: z.string(), name: z.string(), email: z.string() }).nullable(),
  team_id: z.string().nullable(),
  account: z.object({ id: z.string(), name: z.string(), tier: z.string().nullable() }).nullable(),
  requester: z.object({ id: z.string(), name: z.string() }).nullable(),
  channel: z.enum(CHANNEL_KINDS), product_area: z.string().nullable(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  fields: z.record(z.string(), z.unknown()), sla: z.array(z.never()),
  first_response_at: z.string().nullable(), resolved_at: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(), version: z.number(),
});
const Writable = {
  title: z.string().trim().min(1).max(300),
  priority: z.enum(PRIORITIES).optional(),
  assignee_membership_id: Id64.nullable().optional(),
  team_id: Id64.nullable().optional(),
  account_id: Id64.nullable().optional(),
  requester_contact_id: Id64.nullable().optional(),
  product_area: z.string().trim().min(1).max(80).nullable().optional(),
  labels: z.array(Id64).max(20).optional(),
  custom: z.record(z.string().max(40), z.unknown()).optional(),
};
const TimelineItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), id: z.string(), created_at: z.string(), message: z.object({
    id: z.string(), visibility: z.enum(["public", "internal"]), direction: z.enum(["in", "out"]), author: z.object({ type: z.string(), id: z.string().nullable(), name: z.string().nullable() }),
    body: z.object({ text: z.string(), ast: z.unknown() }), source: z.string(), delivery_state: z.string().nullable(), edited_at: z.string().nullable(),
  }) }),
  z.object({ kind: z.literal("event"), id: z.string(), created_at: z.string(), event: z.object({ type: z.string(), actor: z.object({ type: z.string(), id: z.string().nullable() }), data: z.record(z.string(), z.unknown()) }) }),
]);

/** Issues API (T-204, api-spec §1). Read: issues:read; write: issues:write. */
export function issueRoutes(db: Db) {
  const service = createIssuesService(db);
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.get("/v1/issues", {
      schema: {
        tags: ["issues"], summary: "List issues with filters, sort and keyset pagination", headers: WorkspaceHeader,
        querystring: z.object({
          status: csv(STATUS_CATEGORIES).optional(), status_id: Id64.optional(),
          assignee: z.string().max(64).optional().describe("membership id, `me` or `none`"), team: Id64.optional(), account: Id64.optional(),
          priority: csv(PRIORITIES).optional(), channel: csv(CHANNEL_KINDS).optional(), label: Id64.optional(),
          q: z.string().max(200).optional().describe("title text or an issue key such as ACME-12"),
          sort: z.enum(SORTS).optional(), cursor: z.string().max(500).optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
        response: { 200: z.object({ data: z.array(Issue), next_cursor: z.string().nullable() }) },
      },
    }, async (req) => service.list(await requireMember(db, req, "issues:read"), req.query));

    r.get("/v1/issues/stats", {
      schema: {
        tags: ["issues"], summary: "Counts per view, KPIs and 14-day daily series (UTC) for dashboards and inbox tabs", headers: WorkspaceHeader,
        response: { 200: z.object({
          counts: z.object({ open: z.number(), waiting_on_us: z.number(), waiting_on_customer: z.number(), mine: z.number().nullable(), unassigned: z.number(), done: z.number() }),
          kpis: z.object({
            new_today: z.number(), new_yesterday: z.number(), waiting_on_us: z.number(), avg_wait_seconds: z.number().nullable(),
            waiting_on_customer: z.number(), resolved_7d: z.number(), resolved_prev_7d: z.number(), median_first_response_seconds_7d: z.number().nullable(),
          }),
          series: z.array(z.object({ day: z.string(), created: z.number(), resolved: z.number(), first_responses: z.number(), customer_messages: z.number(), team_replies: z.number() })),
        }) },
      },
    }, async (req) => service.stats(await requireMember(db, req, "issues:read")));

    r.post("/v1/issues", {
      schema: {
        tags: ["issues"], summary: "Create an issue (starts in Triage unless `category` is given)", headers: WorkspaceHeader,
        body: z.object({ ...Writable, category: z.enum(STATUS_CATEGORIES).optional() }), response: { 201: Issue },
      },
    }, async (req, reply) => reply.code(201).send(await service.create(await requireMember(db, req, "issues:write"), req.body)));

    r.get("/v1/issues/:ref", {
      schema: { tags: ["issues"], summary: "One issue by id (iss_…), key (ACME-12) or number", headers: WorkspaceHeader, params: Ref, response: { 200: Issue } },
    }, async (req) => service.get(await requireMember(db, req, "issues:read"), req.params.ref));

    r.patch("/v1/issues/:ref", {
      schema: {
        tags: ["issues"], summary: "Update an issue. `labels` replaces the set; pass `version` to fail with 409 if someone else changed it", headers: WorkspaceHeader, params: Ref,
        body: z.object({ ...Writable, title: Writable.title.optional(), status_id: Id64.optional(), status: z.enum(STATUS_CATEGORIES).optional(), version: z.number().int().min(1).optional() })
          .refine((b) => Object.keys(b).some((k) => k !== "version"), "empty patch")
          .refine((b) => !(b.status && b.status_id), "use either status or status_id"),
        response: { 200: Issue },
      },
    }, async (req) => service.update(await requireMember(db, req, "issues:write"), req.params.ref, req.body));

    r.get("/v1/issues/:ref/timeline", {
      schema: {
        tags: ["issues"], summary: "Messages and events in chronological order", headers: WorkspaceHeader, params: Ref,
        response: { 200: z.object({ data: z.array(TimelineItem), truncated: z.boolean() }) },
      },
    }, async (req) => service.timeline(await requireMember(db, req, "issues:read"), req.params.ref));
  };
}

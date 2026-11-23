import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ROLES, type Db } from "@tickzy/db";
import { requireMember, requireUser, WorkspaceHeader } from "../../http/auth.ts";
import type { EmailTransport } from "../../lib/email.ts";
import { createMembersService } from "./service.ts";

const RoleSchema = z.enum(ROLES);
const Member = z.object({
  id: z.string(), user_id: z.string(), name: z.string(), email: z.string(),
  role: RoleSchema, status: z.enum(["active", "deactivated"]), joined_at: z.string(),
});
const Invitation = z.object({
  id: z.string(), email: z.string(), role: RoleSchema, invited_by: z.string().nullable(), created_at: z.string(), expires_at: z.string(),
});
const Token = z.object({ token: z.string().min(10).max(200) });
const IdParam = z.object({ id: z.string().max(64) });

export function memberRoutes(db: Db, deps: { email: EmailTransport; appOrigin: string }) {
  const service = createMembersService({ db, ...deps });
  return async function routes(app: FastifyInstance): Promise<void> {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.get("/v1/members", {
      schema: { tags: ["members"], summary: "Members of the current workspace", headers: WorkspaceHeader, response: { 200: z.object({ data: z.array(Member) }) } },
    }, async (req) => {
      const m = await requireMember(db, req);
      return { data: await service.list(m) };
    });

    r.patch("/v1/members/:id", {
      schema: {
        tags: ["members"], summary: "Change a member's role or deactivate/reactivate them", headers: WorkspaceHeader, params: IdParam,
        body: z.object({ role: RoleSchema.optional(), status: z.enum(["active", "deactivated"]).optional() }).refine((b) => b.role !== undefined || b.status !== undefined, "empty patch"),
        response: { 200: Member },
      },
    }, async (req) => {
      const m = await requireMember(db, req, "members:manage");
      return service.update(m, req.params.id, req.body);
    });

    r.delete("/v1/members/:id", {
      schema: { tags: ["members"], summary: "Remove a member from the workspace", headers: WorkspaceHeader, params: IdParam },
    }, async (req, reply) => {
      const m = await requireMember(db, req, "members:manage");
      await service.remove(m, req.params.id);
      return reply.code(204).send();
    });

    r.get("/v1/invitations", {
      schema: { tags: ["members"], summary: "Pending invitations", headers: WorkspaceHeader, response: { 200: z.object({ data: z.array(Invitation) }) } },
    }, async (req) => {
      const m = await requireMember(db, req, "members:manage");
      return { data: await service.listInvitations(m) };
    });

    r.post("/v1/invitations", {
      schema: {
        tags: ["members"], summary: "Invite someone by email (re-inviting a pending address sends a fresh link)", headers: WorkspaceHeader,
        body: z.object({ email: z.email().max(254), role: RoleSchema }),
        response: { 201: Invitation },
      },
    }, async (req, reply) => {
      const m = await requireMember(db, req, "members:manage");
      return reply.code(201).send(await service.invite(m, req.body));
    });

    r.delete("/v1/invitations/:id", {
      schema: { tags: ["members"], summary: "Revoke a pending invitation", headers: WorkspaceHeader, params: IdParam },
    }, async (req, reply) => {
      const m = await requireMember(db, req, "members:manage");
      await service.revokeInvitation(m, req.params.id);
      return reply.code(204).send();
    });

    r.post("/v1/invitations/preview", {
      schema: {
        tags: ["members"], summary: "Public preview of an invitation (the token is the capability)", body: Token,
        response: { 200: z.object({ workspace_name: z.string(), inviter_name: z.string(), email: z.string(), role: RoleSchema, status: z.enum(["pending", "accepted", "expired", "revoked"]) }) },
      },
    }, async (req) => service.preview(req.body.token));

    r.post("/v1/invitations/accept", {
      schema: { tags: ["members"], summary: "Accept an invitation as the signed-in user", body: Token, response: { 200: z.object({ workspace_id: z.string() }) } },
    }, async (req) => {
      const user = requireUser(req);
      return service.accept(user.userId, req.body.token);
    });
  };
}

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { AppError, newId } from "@tickzy/shared";
import { schema, withWorkspace, type Db, type Role, type Tx } from "@tickzy/db";
import type { EmailTransport } from "../../lib/email.ts";
import type { MemberContext } from "../../http/auth.ts";
import { newToken, parseToken, sha256 } from "../../lib/tokens.ts";
import { pgMessage } from "../../lib/pg-errors.ts";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface MemberDto {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "deactivated";
  joined_at: string;
}
export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
}

type Ctx = MemberContext;

async function audit(tx: Tx, ctx: Ctx, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await tx.insert(schema.auditLog).values({ id: newId("auditLog"), workspaceId: ctx.workspaceId, actorType: ctx.actor.type, actorId: ctx.actor.id, action, targetType, targetId, metadata });
}

/** Refuses any change that would leave the workspace without an active admin. */
async function assertAdminRemains(tx: Tx, excludingMembershipId: string) {
  const rows = await tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.role, "admin"), eq(schema.memberships.status, "active")));
  if (rows.filter((r) => r.id !== excludingMembershipId).length === 0) {
    throw new AppError("conflict", "A workspace needs at least one active admin. Promote someone else first.");
  }
}

export function createMembersService(deps: { db: Db; email: EmailTransport; appOrigin: string; now?: () => Date }) {
  const { db, email, appOrigin } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async list(ctx: Ctx): Promise<MemberDto[]> {
      return withWorkspace(db, ctx, async (tx) => {
        const rows = await tx
          .select({ m: schema.memberships, u: schema.users })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .orderBy(schema.memberships.createdAt);
        return rows.map(({ m, u }) => ({
          id: m.id, user_id: u.id, name: u.name, email: u.email, role: m.role, status: m.status, joined_at: m.createdAt.toISOString(),
        }));
      });
    },

    async update(ctx: Ctx, membershipId: string, patch: { role?: Role | undefined; status?: "active" | "deactivated" | undefined }): Promise<MemberDto> {
      await withWorkspace(db, ctx, async (tx) => {
        const [current] = await tx.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId)).for("update");
        if (!current) throw new AppError("not_found", "Member not found");
        const losesAdmin = current.role === "admin" && current.status === "active" && ((patch.role && patch.role !== "admin") || patch.status === "deactivated");
        if (losesAdmin) await assertAdminRemains(tx, membershipId);
        const values: Partial<typeof schema.memberships.$inferInsert> = {};
        if (patch.role) values.role = patch.role;
        if (patch.status) values.status = patch.status;
        await tx.update(schema.memberships).set(values).where(eq(schema.memberships.id, membershipId));
        await audit(tx, ctx, "member.updated", "membership", membershipId, { from: { role: current.role, status: current.status }, to: patch });
      });
      const all = await this.list(ctx);
      return all.find((m) => m.id === membershipId)!;
    },

    async remove(ctx: Ctx, membershipId: string): Promise<void> {
      await withWorkspace(db, ctx, async (tx) => {
        const [current] = await tx.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId)).for("update");
        if (!current) throw new AppError("not_found", "Member not found");
        if (current.role === "admin" && current.status === "active") await assertAdminRemains(tx, membershipId);
        await tx.delete(schema.memberships).where(eq(schema.memberships.id, membershipId));
        await audit(tx, ctx, "member.removed", "membership", membershipId, { user_id: current.userId, role: current.role });
        await tx.insert(schema.outbox).values({ workspaceId: ctx.workspaceId, type: "member.removed", payload: { user_id: current.userId } });
      });
    },

    async listInvitations(ctx: Ctx): Promise<InvitationDto[]> {
      return withWorkspace(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(schema.invitations)
          .where(and(isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt)))
          .orderBy(desc(schema.invitations.createdAt));
        return rows.map((i) => ({ id: i.id, email: i.email, role: i.role, invited_by: i.invitedBy, created_at: i.createdAt.toISOString(), expires_at: i.expiresAt.toISOString() }));
      });
    },

    /** Creates an invitation, or re-sends a pending one with a fresh token and expiry (old link stops working). */
    async invite(ctx: Ctx, input: { email: string; role: Role }): Promise<InvitationDto> {
      const address = input.email.trim().toLowerCase();
      const t = newToken();
      const expiresAt = new Date(now().getTime() + INVITE_TTL_MS);
      const { invitation, workspaceName, inviterName } = await withWorkspace(db, ctx, async (tx) => {
        const member = await tx.execute(sql`
          SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE lower(u.email) = ${address} AND m.status = 'active' LIMIT 1`);
        if (member.rows.length) throw new AppError("conflict", `${address} is already a member of this workspace`);
        const [pending] = await tx.select().from(schema.invitations).where(and(eq(schema.invitations.email, address), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt))).for("update");
        let row: typeof schema.invitations.$inferSelect;
        if (pending) {
          [row] = await tx.update(schema.invitations)
            .set({ role: input.role, tokenId: t.id, secretHash: t.secretHash, expiresAt, invitedBy: ctx.userId ?? null, createdAt: now() })
            .where(eq(schema.invitations.id, pending.id)).returning() as [typeof row];
          await audit(tx, ctx, "invitation.resent", "invitation", row.id, { email: address, role: input.role });
        } else {
          [row] = await tx.insert(schema.invitations)
            .values({ id: newId("invitation"), workspaceId: ctx.workspaceId, email: address, role: input.role, tokenId: t.id, secretHash: t.secretHash, invitedBy: ctx.userId ?? null, expiresAt })
            .returning() as [typeof row];
          await audit(tx, ctx, "invitation.created", "invitation", row.id, { email: address, role: input.role });
        }
        const [ws] = await tx.select({ name: schema.workspaces.name }).from(schema.workspaces).limit(1);
        const [inviter] = ctx.userId
          ? await tx.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, ctx.userId))
          : [];
        return { invitation: row, workspaceName: ws!.name, inviterName: inviter?.name || inviter?.email || ws!.name };
      });
      await email.send({
        to: address,
        subject: `${inviterName} invited you to ${workspaceName} on Tickzy`,
        text: `${inviterName} invited you to join ${workspaceName} on Tickzy as ${input.role}.\n\nAccept the invitation:\n${appOrigin}/invite#token=${t.token}\n\nThis invitation expires in 7 days.`,
      });
      return { id: invitation.id, email: invitation.email, role: invitation.role, invited_by: invitation.invitedBy, created_at: invitation.createdAt.toISOString(), expires_at: invitation.expiresAt.toISOString() };
    },

    async revokeInvitation(ctx: Ctx, invitationId: string): Promise<void> {
      await withWorkspace(db, ctx, async (tx) => {
        const res = await tx.update(schema.invitations).set({ revokedAt: now() })
          .where(and(eq(schema.invitations.id, invitationId), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt))).returning();
        if (res.length === 0) throw new AppError("not_found", "Pending invitation not found");
        await audit(tx, ctx, "invitation.revoked", "invitation", invitationId, { email: res[0]!.email });
      });
    },

    async preview(token: string) {
      const parts = parseToken(token);
      if (!parts) throw new AppError("not_found", "Invitation not found");
      const res = await db.execute(sql`SELECT * FROM invitation_preview(${parts.id}, ${sha256(parts.secret)})`);
      const row = res.rows[0];
      if (!row) throw new AppError("not_found", "Invitation not found");
      return { workspace_name: String(row.workspace_name), inviter_name: String(row.inviter_name || row.workspace_name), email: String(row.email), role: String(row.role) as Role, status: String(row.status) as "pending" | "accepted" | "expired" | "revoked" };
    },

    async accept(userId: string, token: string): Promise<{ workspace_id: string }> {
      const parts = parseToken(token);
      if (!parts) throw new AppError("not_found", "This invitation is invalid or has expired.");
      try {
        const res = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
          return tx.execute(sql`SELECT accept_invitation(${parts.id}, ${sha256(parts.secret)}, ${newId("auditLog")}, ${newId("membership")}) AS ws`);
        });
        return { workspace_id: String(res.rows[0]!.ws) };
      } catch (err) {
        const m = pgMessage(err);
        if (m.includes("invitation_email_mismatch")) throw new AppError("forbidden", "This invitation was sent to a different email address. Sign in with that address to accept it.");
        if (m.includes("invitation_invalid")) throw new AppError("not_found", "This invitation is invalid, was revoked, or has expired.");
        throw err;
      }
    },
  };
}

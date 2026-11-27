import { and, asc, eq } from "drizzle-orm";
import { AppError, newId } from "@tickzy/shared";
import { schema, withWorkspace, type Db, type Tx } from "@tickzy/db";
import type { MemberContext } from "../../http/auth.ts";
import { isUniqueViolation } from "../../lib/pg-errors.ts";
import { randomBase32 } from "../../lib/tokens.ts";

/**
 * Forwarding addresses (T-302a): a customer forwards support@their-company.com to `<slug>-<random>@<inbound domain>`;
 * mail arriving there becomes issues in their workspace. Admin-only (channels:manage), every change audited.
 */
export interface EmailAddressDto {
  id: string; address: string; name: string; endpoint_type: "customer" | "community" | "internal" | "triage";
  default_account_id: string | null; status: "active" | "disabled"; created_at: string;
}
type Endpoint = typeof schema.channelEndpoints.$inferSelect;
const toDto = (e: Endpoint): EmailAddressDto => ({
  id: e.id, address: e.externalId, name: e.name, endpoint_type: e.endpointType, default_account_id: e.defaultAccountId,
  status: e.status, created_at: e.createdAt.toISOString(),
});

async function audit(tx: Tx, ctx: MemberContext, action: string, id: string, metadata: Record<string, unknown>) {
  await tx.insert(schema.auditLog).values({ id: newId("auditLog"), workspaceId: ctx.workspaceId, actorType: ctx.actor.type, actorId: ctx.actor.id, action, targetType: "channel_endpoint", targetId: id, metadata });
}

export function createEmailAddressService(db: Db, inboundDomain: string | undefined) {
  async function checkAccount(tx: Tx, accountId: string | null | undefined) {
    if (!accountId) return;
    const [a] = await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, accountId));
    if (!a) throw new AppError("validation_failed", "Invalid account", [{ path: "default_account_id", issue: "not found" }]);
  }
  return {
    configured: () => !!inboundDomain,

    list: (ctx: MemberContext) => withWorkspace(db, ctx, async (tx) => ({
      inbound_domain: inboundDomain ?? null,
      data: (await tx.select().from(schema.channelEndpoints).where(eq(schema.channelEndpoints.kind, "email_address")).orderBy(asc(schema.channelEndpoints.createdAt))).map(toDto),
    })),

    create: (ctx: MemberContext, input: { name: string; endpoint_type?: EmailAddressDto["endpoint_type"] | undefined; default_account_id?: string | null | undefined }) => withWorkspace(db, ctx, async (tx) => {
      if (!inboundDomain) throw new AppError("conflict", "Inbound email is not configured on this server (INBOUND_EMAIL_DOMAIN and Postmark credentials).");
      await checkAccount(tx, input.default_account_id);
      let [connection] = await tx.select().from(schema.channelConnections)
        .where(and(eq(schema.channelConnections.kind, "email"), eq(schema.channelConnections.status, "active")));
      if (!connection) {
        [connection] = await tx.insert(schema.channelConnections).values({ id: newId("channelConnection"), workspaceId: ctx.workspaceId, kind: "email" }).returning();
      }
      const [ws] = await tx.select({ slug: schema.workspaces.slug }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
      const base = (ws?.slug ?? "support").replace(/[^a-z0-9-]/g, "").slice(0, 40) || "support";
      for (let attempt = 0; attempt < 3; attempt++) {
        const address = `${base}-${randomBase32(5)}@${inboundDomain}`;
        try {
          const [row] = await tx.transaction((sp) => sp.insert(schema.channelEndpoints).values({
            id: newId("channelEndpoint"), workspaceId: ctx.workspaceId, connectionId: connection!.id, kind: "email_address", externalId: address,
            name: input.name, endpointType: input.endpoint_type ?? "customer", defaultAccountId: input.default_account_id ?? null,
          }).returning());
          await audit(tx, ctx, "email_address.created", row!.id, { address, name: input.name });
          return toDto(row!);
        } catch (err) {
          if (!isUniqueViolation(err)) throw err; // a random collision: try another suffix
        }
      }
      throw new AppError("conflict", "Could not allocate a unique address; try again");
    }),

    update: (ctx: MemberContext, id: string, input: { name?: string | undefined; endpoint_type?: EmailAddressDto["endpoint_type"] | undefined; default_account_id?: string | null | undefined; status?: "active" | "disabled" | undefined }) => withWorkspace(db, ctx, async (tx) => {
      await checkAccount(tx, input.default_account_id);
      const set: Partial<typeof schema.channelEndpoints.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) set.name = input.name;
      if (input.endpoint_type !== undefined) set.endpointType = input.endpoint_type;
      if (input.default_account_id !== undefined) set.defaultAccountId = input.default_account_id;
      if (input.status !== undefined) set.status = input.status;
      const [row] = await tx.update(schema.channelEndpoints).set(set)
        .where(and(eq(schema.channelEndpoints.id, id), eq(schema.channelEndpoints.kind, "email_address"))).returning();
      if (!row) throw new AppError("not_found", "Email address not found");
      await audit(tx, ctx, "email_address.updated", id, { fields: Object.keys(input) });
      return toDto(row);
    }),
  };
}

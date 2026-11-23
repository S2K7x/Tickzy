import { desc, eq, and, isNull, sql } from "drizzle-orm";
import { AppError, newId } from "@tickzy/shared";
import { schema, withWorkspace, type Db, type Tx } from "@tickzy/db";
import { constantTimeEqual, newToken, parseToken, sha256 } from "../../lib/tokens.ts";
import { API_TOKEN_PREFIX, type MemberContext, type TokenPrincipal } from "../../http/auth.ts";

export interface ApiTokenDto {
  id: string;
  name: string;
  /** First characters of the token, safe to display, to recognise it later. */
  prefix: string;
  scopes: string[];
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

const toDto = (t: typeof schema.apiTokens.$inferSelect): ApiTokenDto => ({
  id: t.id,
  name: t.name,
  prefix: `${API_TOKEN_PREFIX}${t.tokenId.slice(0, 6)}`,
  scopes: [...t.scopes].sort(),
  created_by: t.createdBy,
  created_at: t.createdAt.toISOString(),
  expires_at: t.expiresAt?.toISOString() ?? null,
  last_used_at: t.lastUsedAt?.toISOString() ?? null,
});

async function audit(tx: Tx, ctx: MemberContext, action: string, tokenId: string, metadata: Record<string, unknown>) {
  await tx.insert(schema.auditLog).values({
    id: newId("auditLog"), workspaceId: ctx.workspaceId, actorType: ctx.actor.type, actorId: ctx.actor.id,
    action, targetType: "api_token", targetId: tokenId, metadata,
  });
}

export function createApiTokenService(db: Db, now: () => Date = () => new Date()) {
  return {
    /** Bearer authentication: constant-time hash comparison, then a throttled last_used_at update. */
    async authenticate(raw: string): Promise<TokenPrincipal | null> {
      const parts = raw.startsWith(API_TOKEN_PREFIX) ? parseToken(raw.slice(API_TOKEN_PREFIX.length)) : null;
      if (!parts) return null;
      const res = await db.execute(sql`SELECT * FROM api_token_lookup(${parts.id})`);
      const row = res.rows[0] as { id: string; workspace_id: string; secret_hash: Buffer; scopes: string[] } | undefined;
      if (!row || !constantTimeEqual(row.secret_hash, sha256(parts.secret))) return null;
      await db.execute(sql`SELECT api_token_touch(${row.id})`);
      return { type: "api_token", tokenId: row.id, workspaceId: row.workspace_id, scopes: new Set(row.scopes) };
    },

    async list(ctx: MemberContext): Promise<ApiTokenDto[]> {
      return withWorkspace(db, ctx, async (tx) => {
        const rows = await tx.select().from(schema.apiTokens).where(isNull(schema.apiTokens.revokedAt)).orderBy(desc(schema.apiTokens.createdAt));
        return rows.map(toDto);
      });
    },

    /** Returns the full token exactly once; only its hash is stored. */
    async create(ctx: MemberContext, input: { name: string; scopes: string[]; expires_in_days: number | null }): Promise<ApiTokenDto & { token: string }> {
      const t = newToken();
      const scopes = [...new Set(input.scopes)];
      const expiresAt = input.expires_in_days ? new Date(now().getTime() + input.expires_in_days * 86_400_000) : null;
      const row = await withWorkspace(db, ctx, async (tx) => {
        const [created] = await tx.insert(schema.apiTokens).values({
          id: newId("apiToken"), workspaceId: ctx.workspaceId, name: input.name, tokenId: t.id, secretHash: t.secretHash,
          scopes, createdBy: ctx.userId ?? null, expiresAt,
        }).returning();
        await audit(tx, ctx, "api_token.created", created!.id, { name: input.name, scopes, expires_at: expiresAt?.toISOString() ?? null });
        return created!;
      });
      return { ...toDto(row), token: `${API_TOKEN_PREFIX}${t.token}` };
    },

    async revoke(ctx: MemberContext, id: string): Promise<void> {
      await withWorkspace(db, ctx, async (tx) => {
        const res = await tx.update(schema.apiTokens).set({ revokedAt: now() })
          .where(and(eq(schema.apiTokens.id, id), isNull(schema.apiTokens.revokedAt))).returning({ name: schema.apiTokens.name });
        if (res.length === 0) throw new AppError("not_found", "API token not found");
        await audit(tx, ctx, "api_token.revoked", id, { name: res[0]!.name });
      });
    },
  };
}
export type ApiTokenService = ReturnType<typeof createApiTokenService>;

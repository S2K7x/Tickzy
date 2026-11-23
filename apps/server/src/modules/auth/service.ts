import { sql } from "drizzle-orm";
import { AppError, newId } from "@tickzy/shared";
import { withUser, type Db } from "@tickzy/db";
import type { EmailTransport } from "./email.ts";
import { constantTimeEqual, newToken, parseToken, sha256 } from "./tokens.ts";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_RENEW_WITHIN_MS = 15 * 24 * 60 * 60 * 1000;
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const LOGIN_TOKEN_MAX_PER_WINDOW = 5;

export interface SessionInfo {
  sessionId: string;
  userId: string;
  expiresAt: Date;
  /** Set when the session was renewed and the cookie must be re-issued. */
  renewed: boolean;
}

export interface AuthServiceDeps {
  db: Db;
  email: EmailTransport;
  appOrigin: string;
  now?: () => Date;
}

function pgErrorMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return `${e.message ?? ""} ${e.cause?.message ?? ""}`;
}

export function createAuthService({ db, email, appOrigin, now = () => new Date() }: AuthServiceDeps) {
  return {
    /** FR-1.2: request a magic link. Same outcome whether or not the email belongs to a user (no enumeration). */
    async requestMagicLink(emailAddress: string, ip: string | null): Promise<void> {
      const normalized = emailAddress.trim().toLowerCase();
      const t = newToken();
      const expires = new Date(now().getTime() + LOGIN_TOKEN_TTL_MS);
      try {
        await db.execute(sql`SELECT auth_issue_login_token(${t.id}, ${normalized}, ${t.secretHash}, ${expires.toISOString()}::timestamptz,
          ${ip}::inet, ${LOGIN_TOKEN_MAX_PER_WINDOW}, interval '15 minutes')`);
      } catch (err) {
        if (pgErrorMessage(err).includes("rate_limited")) throw new AppError("rate_limited", "Too many sign-in links requested. Try again in a few minutes.");
        throw err;
      }
      // Fragment (#) keeps the token out of server logs and Referer headers; the web app POSTs it back.
      const link = `${appOrigin}/auth/verify#token=${t.token}`;
      await email.send({
        to: normalized,
        subject: "Your Tickzy sign-in link",
        text: `Sign in to Tickzy:\n\n${link}\n\nThis link expires in 15 minutes and can be used once. If you didn't request it, ignore this email.`,
      });
    },

    /** Consumes a magic-link token, creating the user on first sign-in, and opens a session. */
    async verifyMagicLink(token: string, meta: { userAgent: string | null; ip: string | null }): Promise<{ sessionToken: string; userId: string; expiresAt: Date }> {
      const parts = parseToken(token);
      const invalid = new AppError("unauthenticated", "This sign-in link is invalid or has expired. Request a new one.");
      if (!parts) throw invalid;
      const res = await db.execute(sql`SELECT auth_consume_login_token(${parts.id}, ${sha256(parts.secret)}) AS email`);
      const emailAddress = res.rows[0]?.email as string | null | undefined;
      if (!emailAddress) throw invalid;
      const created = await db.execute(sql`SELECT upsert_user(${newId("user")}, ${emailAddress}, '') AS id`);
      const userId = String(created.rows[0]!.id);
      const session = await this.createSession(userId, meta);
      return { sessionToken: session.token, userId, expiresAt: session.expiresAt };
    },

    async createSession(userId: string, meta: { userAgent: string | null; ip: string | null }): Promise<{ token: string; expiresAt: Date }> {
      const t = newToken();
      const expiresAt = new Date(now().getTime() + SESSION_TTL_MS);
      await db.execute(sql`SELECT auth_create_session(${t.id}, ${userId}, ${t.secretHash}, ${expiresAt.toISOString()}::timestamptz, ${meta.userAgent}, ${meta.ip}::inet)`);
      return { token: t.token, expiresAt };
    },

    /** Validates a session token (constant-time); renews it when it is in the second half of its life. */
    async validateSession(token: string): Promise<SessionInfo | null> {
      const parts = parseToken(token);
      if (!parts) return null;
      const res = await db.execute(sql`SELECT * FROM auth_get_session(${parts.id})`);
      const row = res.rows[0] as { user_id: string; secret_hash: Buffer; expires_at: Date | string } | undefined;
      if (!row) return null;
      if (!constantTimeEqual(sha256(parts.secret), Buffer.from(row.secret_hash))) return null;
      let expiresAt = new Date(row.expires_at);
      let renewed = false;
      if (expiresAt.getTime() - now().getTime() < SESSION_RENEW_WITHIN_MS) {
        expiresAt = new Date(now().getTime() + SESSION_TTL_MS);
        await db.execute(sql`SELECT auth_extend_session(${parts.id}, ${expiresAt.toISOString()}::timestamptz)`);
        renewed = true;
      }
      return { sessionId: parts.id, userId: row.user_id, expiresAt, renewed };
    },

    async signOut(sessionId: string): Promise<void> {
      await db.execute(sql`SELECT auth_delete_session(${sessionId})`);
    },

    async signOutEverywhere(userId: string): Promise<number> {
      const res = await withUser(db, userId, (tx) => tx.execute(sql`SELECT auth_delete_my_sessions() AS n`));
      return Number(res.rows[0]!.n);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

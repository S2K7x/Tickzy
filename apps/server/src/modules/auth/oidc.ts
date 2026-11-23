import * as client from "openid-client";
import { sql } from "drizzle-orm";
import { AppError, newId } from "@tickzy/shared";
import type { Db } from "@tickzy/db";

/**
 * Google & Microsoft sign-in (T-101b, ADR-024) with openid-client (OpenID-certified relying party):
 * authorization code flow + PKCE (S256) + state + nonce, ID token validated by the library (signature, iss, aud,
 * exp, nonce; Entra multi-tenant issuer resolved from the token's `tid`).
 */
export type ProviderName = "google" | "microsoft";

export interface ProviderSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export interface OidcConfig {
  google?: ProviderSettings | undefined;
  microsoft?: ProviderSettings | undefined;
  /** Public origin that serves /v1 (the web origin, which proxies the API): redirect URIs are built from it. */
  publicOrigin: string;
}

/** Short-lived, per-attempt secrets kept in an httpOnly cookie between /start and /callback. */
export interface PendingLogin {
  provider: ProviderName;
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  createdAt: number;
}

export const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;
const isLocal = (url: URL) => url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");

/** Only same-app relative paths may be used after sign-in (no open redirects). */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.length > 200) return "/";
  return value;
}

function pgMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return `${e.message ?? ""} ${e.cause?.message ?? ""}`;
}

/**
 * Decides whether the provider vouches for the email (ADR-024):
 *  - Google: `email_verified === true`.
 *  - Microsoft: the `email` claim is admin-editable and unverified (nOAuth); trusted only with the optional claim
 *    `xms_edov === true` (email domain owner verified). Otherwise the identity can still sign in once linked,
 *    but cannot create or link an account by email.
 */
export function identityFromClaims(provider: ProviderName, claims: Record<string, unknown>): { subject: string; email: string | null; trusted: boolean; name: string } {
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
  const name = typeof claims.name === "string" ? claims.name.slice(0, 120) : "";
  if (provider === "google") {
    if (typeof claims.sub !== "string" || !claims.sub) throw new AppError("unauthenticated", "Missing subject");
    return { subject: claims.sub, email, trusted: claims.email_verified === true, name };
  }
  if (typeof claims.tid !== "string" || typeof claims.oid !== "string") throw new AppError("unauthenticated", "Missing tenant or object id");
  return { subject: `${claims.tid}:${claims.oid}`, email, trusted: claims.xms_edov === true || claims.xms_edov === "true" || claims.xms_edov === 1, name };
}

export function createOidc(db: Db, cfg: OidcConfig) {
  const cache = new Map<ProviderName, Promise<client.Configuration>>();

  function settings(provider: ProviderName): ProviderSettings {
    const s = cfg[provider];
    if (!s) throw new AppError("not_found", "This sign-in method is not enabled");
    return s;
  }

  function configuration(provider: ProviderName): Promise<client.Configuration> {
    let p = cache.get(provider);
    if (!p) {
      const s = settings(provider);
      const issuer = new URL(s.issuer);
      p = client.discovery(issuer, s.clientId, s.clientSecret, undefined, isLocal(issuer) ? { execute: [client.allowInsecureRequests] } : undefined);
      p.catch(() => cache.delete(provider)); // retry discovery on the next attempt
      cache.set(provider, p);
    }
    return p;
  }

  const redirectUri = (provider: ProviderName) => `${cfg.publicOrigin}/v1/auth/oauth/${provider}/callback`;

  return {
    enabled(): ProviderName[] {
      return (["google", "microsoft"] as const).filter((p) => !!cfg[p]);
    },

    async start(provider: ProviderName, returnTo: string): Promise<{ url: URL; pending: PendingLogin }> {
      const config = await configuration(provider);
      const pending: PendingLogin = {
        provider,
        state: client.randomState(),
        nonce: client.randomNonce(),
        verifier: client.randomPKCECodeVerifier(),
        returnTo: safeReturnTo(returnTo),
        createdAt: Date.now(),
      };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri(provider),
        scope: "openid email profile",
        response_type: "code",
        code_challenge: await client.calculatePKCECodeChallenge(pending.verifier),
        code_challenge_method: "S256",
        state: pending.state,
        nonce: pending.nonce,
        prompt: "select_account",
      });
      return { url, pending };
    },

    /** Validates the callback and returns the Tickzy user id (creating or linking per ADR-024). */
    async finish(provider: ProviderName, callbackUrl: URL, pending: PendingLogin | null): Promise<string> {
      if (!pending || pending.provider !== provider || Date.now() - pending.createdAt > PENDING_LOGIN_TTL_MS) {
        throw new AppError("unauthenticated", "Sign-in attempt expired or was started in another browser");
      }
      const config = await configuration(provider);
      // The library compares redirect_uri with the current URL's origin+path, so present the public URL.
      const current = new URL(redirectUri(provider));
      current.search = callbackUrl.search;
      const tokens = await client.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: pending.verifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new AppError("unauthenticated", "No ID token");
      const id = identityFromClaims(provider, claims as Record<string, unknown>);
      try {
        const res = await db.execute(sql`SELECT auth_oauth_sign_in(${provider}, ${id.subject}, ${id.email}, ${id.trusted}, ${id.name},
          ${newId("user")}, ${newId("identity")}) AS user_id`);
        return String(res.rows[0]!.user_id);
      } catch (err) {
        if (pgMessage(err).includes("email_unverified")) throw new AppError("forbidden", "email_unverified");
        throw err;
      }
    },
  };
}
export type Oidc = ReturnType<typeof createOidc>;

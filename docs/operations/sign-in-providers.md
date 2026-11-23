# Sign-in providers setup (Google & Microsoft) — T-101b, ADR-024

Tickzy offers "Continue with Google / Microsoft" only when the provider's client id **and** secret are configured.
Redirect URI to register at each provider (the web origin, which proxies `/v1` to the API):

```
<APP_ORIGIN>/v1/auth/oauth/google/callback
<APP_ORIGIN>/v1/auth/oauth/microsoft/callback
```

## Google
1. Google Cloud console → APIs & Services → Credentials → *Create OAuth client ID* → type **Web application**.
2. Authorised redirect URI: the Google callback above. Consent screen scopes: `openid`, `email`, `profile`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (secret manager in production; never commit).
4. Only Google accounts whose email is verified (`email_verified=true`) can create or link a Tickzy account.

## Microsoft (Entra ID, multi-tenant)
1. Entra admin center → App registrations → *New registration* → supported account types: **accounts in any organizational directory (and personal Microsoft accounts if wanted)**; platform **Web**, redirect URI: the Microsoft callback above.
2. Certificates & secrets → new client secret → `MICROSOFT_CLIENT_SECRET`; Application (client) id → `MICROSOFT_CLIENT_ID`. Keep `MICROSOFT_ISSUER=https://login.microsoftonline.com/common/v2.0`.
3. **Token configuration → Add optional claim → ID token → `xms_edov`** (email domain owner verified).
   Tickzy uses a Microsoft email to create or link an account **only** when `xms_edov` is true, because the plain
   `email` claim can be set by any tenant admin and is unverified ("nOAuth"). Reports in 2026 say `xms_edov` can be
   hard to enable in some tenants; without it, Microsoft users must first sign in with an email link — after an
   identity is linked it keeps working (keyed on `tid:oid`, never the email). **Open item:** verify `xms_edov`
   on the production app registration before launch; revisit if Microsoft retires it.

## Verifying a deployment
- `GET /v1/auth/providers` lists the enabled providers.
- Sign in once with each provider in a private window; check `/sign-in?error=…` messages for a refused account.
- Local/E2E without real providers: `node apps/server/scripts/mock-oidc.ts <id> <secret>` prints a mock issuer URL
  to use as `GOOGLE_ISSUER` / `MICROSOFT_ISSUER` (http issuers are accepted only on localhost and never in production).

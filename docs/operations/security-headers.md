# Security headers in production (T-110, ADR-029)

The API sets its own headers (`apps/server/src/http/security-headers.ts`) — nothing to configure, except that HSTS is
only sent when `COOKIE_SECURE=true` (required in production).

The **web app** is static files; whatever serves them (CDN, Fly static, a reverse proxy) **must** send, on every
response, exactly the headers in `apps/web/security-headers.ts` (`WEB_SECURITY_HEADERS`) — at the time of writing:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (https only) |

The app and the API must be served from the **same origin** (`/v1` routed to the API), because the policy allows
`connect-src 'self'` only (REST and the `/v1/realtime` WebSocket).

**Verify after every deploy:**
```bash
curl -sI https://app.example.com/ | grep -iE 'content-security-policy|x-frame-options|nosniff|strict-transport'
```
and run `node apps/web/scripts/e2e-csp.cjs` against the deployment (no violations, no third-party requests).

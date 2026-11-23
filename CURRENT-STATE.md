# CURRENT STATE — Tickzy

_Last updated: 2026-11-23 (session 4)._ Read this first, then `docs/blueprint/backlog.md`. Process: `docs/process/development-pipeline.md` (we are in **Stage 5 · Build**; status per stage in `docs/process/pipeline-checklist.md`).

## Phase
Implementation: **M0 · Foundations complete** (except CI verification on GitHub); **M1 · Identity & access** in progress (T-104, T-101, T-105, T-102, T-103, T-106 done; T-101b left). Planning docs are complete and approved:
strategy `docs/strategy/product-strategy.md` · architecture `docs/architecture/` · UX `docs/ux/ux-spec.md` + design canvas (https://claude.ai/artifact/BvvyCE24er29B2iYNqLVxg, source `design/canvas/`) · blueprint `docs/blueprint/`.

## Done (verified by tests)
| Task | What exists | Verification |
|---|---|---|
| T-001 | pnpm monorepo, TS 5.9 strict, ESLint flat config, Prettier, Vitest | `pnpm lint`, `pnpm typecheck` clean |
| T-002 | `@tickzy/shared`: prefixed ULID ids, `AppError` + error codes | 4 unit tests |
| T-003 | `@tickzy/db`: migration runner (checksums, advisory lock), `0001_foundation.sql` (roles, users, workspaces, memberships, counters, audit_log, outbox, RLS, grants, SECURITY DEFINER entry points), Drizzle schema | migration test (fresh + idempotent + RLS flags) |
| T-004 | `withWorkspace` / `withUser` transaction-local tenant context | **RLS isolation suite**: 10 tests (no context → no rows, cross-tenant read/insert/update/move/delete denied, audit append-only, no setting leak across pool, user visibility) |
| T-005 | `@tickzy/server` Fastify 5: zod config, request ids, error envelope, `/healthz`, `/readyz`, graceful shutdown | 5 HTTP tests + real-process smoke test (curl) |
| T-006 | Dev auth shim `Bearer dev_<userId>` (AUTH_DEV_MODE only; refused in production) | tests for disabled mode + config guard |
| T-007 | Workspaces API: POST `/v1/workspaces`, GET/PATCH `/v1/workspaces/current`, GET `/v1/me/workspaces`; audit + outbox in same tx | 10 integration tests |
| T-008 | Permission matrix + `requireMember(db, req, permission)` | 3 matrix tests + 403/404 tests |
| T-012 | OpenAPI 3.1 at `/v1/openapi.json` | test asserts paths |
| T-009 | Migration `0002` (pgboss schema, NOTIFY trigger, `claim_outbox()`), migration runner installs pg-boss and hands ownership to `tickzy_app`, `JobQueue` interface + pg-boss impl, `OutboxRelay` (transactional enqueue, deterministic job ids), worker process role (`--role=api\|worker\|all`) — ADR-020 | 9 relay tests (fan-out, no loss on failure, atomic batch, no duplicates on replay, rollback, tenant visibility, e2e via NOTIFY) + 1 migration test (queue schema owned by app role, no DB-level CREATE) + real-process smoke (worker published events) |
| T-010 | `@tickzy/web`: Vite 8 + React 19 + TanStack Router/Query + Tailwind v4 with UX-spec tokens; responsive shell (sidebar ≥1280, icon rail 768–1279, bottom tabs <768), persisted light/dark theme with no flash, honest placeholders (no fake data), onboarding checklist on Overview | 6 jsdom tests (nav variants, aria-current, theme toggle/persist, axe) + **real Chromium check** `apps/web/scripts/verify-responsive.cjs`: 6/6 (390/768/1280 × light/dark: correct nav, no horizontal overflow, 0 axe violations incl. contrast) |
| T-104 | `GET /v1/audit-log` (admin-only; filter actor/action/date; exact keyset paging on ULID id) | 6 integration tests (31 entries paged exactly once incl. same-timestamp rows, filters, 403 for agents, tenant isolation, tampered cursor 422) |

| T-101 | Auth core per **ADR-021** (in-house, replaces Better Auth): migration `0003_auth.sql` (sessions + login_tokens reachable only via `auth_*` SECURITY DEFINER functions), magic-link sign-in (single-use, 15 min, URL-fragment token, no enumeration, 5 per email per 15 min), sessions (`id.secret`, SHA-256 stored, constant-time compare, httpOnly/Secure/SameSite=Lax cookie, 30-day sliding), sign-out / sign-out-everywhere, CSRF Origin allow-list, `EmailTransport` (console dev / memory tests), config guards (no console email or insecure cookies in production) | 4 token tests + 18 auth integration tests (flow, single use, expiry, tampering, rate limit, enumeration, sliding renewal, forged secret, revocation, CSRF incl. login CSRF, no direct table access) + real-process smoke (link → verify → session) |

| T-105 | Web sign-in & onboarding: API client (error envelope), session query, route guard (signed-out → /sign-in, no workspace → /onboarding, API down → retry screen), sign-in page (no enumeration), verify page (token from URL fragment, POSTed once even across remounts, removed from URL), create-workspace page (slug/prefix derived, field errors), user/workspace in top bar, sign-out; "New issue" disabled until M2 | 13 new jsdom tests (19 web) + **real-stack E2E** `apps/web/scripts/e2e-auth.cjs`: 18/18 (redirect, link from server email, token stripped, httpOnly/Lax cookie unreadable from JS, onboarding, reload, dark mode, sign-out kills server session, axe on every page, 390 & 1280) + `verify-responsive.cjs` now signed in: 8/8 (390/768/1024/1280 × light/dark) |

| T-102 | Invitations & members (FR-1.3): migration `0004_invitations.sql` (tenant RLS; `invitation_preview()` / `accept_invitation()` SECURITY DEFINER — token is the capability, accept requires the invited email, single-use, 7-day expiry, upsert/reactivate membership + audit + outbox `member.joined`); `modules/members` API (list/patch/delete members with last-active-admin guard, invite / re-invite rotates token / revoke, public preview, accept), all admin actions audited; shared `lib/email.ts` + `lib/tokens.ts` (moved from auth, no duplication). Web: Settings layout + **Members & roles** (invite form, role select with free-seat labels, deactivate/reactivate, remove with confirm, pending invites with resend/revoke; read-only for non-admins), `/invite` landing page (preview; token moved from URL fragment to storage so it survives the magic-link round trip; wrong-account and used/expired/revoked states), sign-in prefilled with the invited email, shared current-workspace store, phone **More** tab now lists AI/Knowledge/Analytics/Settings, Overview "Invite your team" links to Members | 18 server integration tests (invite email + link, preview, token rotation, wrong user 403, unauthenticated 401, accept → role/audit/outbox, single use, already-member 409, revoked/expired, permissions 403/404, validation, tenant isolation, list/role change/last-admin guard/deactivate/remove/re-invite, cross-tenant member edits 404) + 10 jsdom tests + **real-stack E2E** `apps/web/scripts/e2e-invite.cjs`: 23/23 (two users, 1280 + 390, light + dark, axe 0 violations on every page) |

| T-103 | API tokens per **ADR-022**: migration `0005_api_tokens.sql` (tenant RLS, CHECK forbids `developers:manage`, column-level UPDATE on `revoked_at`/`name` only, `api_token_lookup()`/`api_token_touch()` entry points); bearer auth `tkz_live_<id>.<secret>` (hash only, constant-time, 401 on bad/revoked/expired); token principal = workspace principal (workspace from token, conflicting header → 404, scopes instead of role, user-only endpoints → 403, audit `actor_type=api_token`); `MemberContext.actor` used for all audit rows; permissions list moved to `@tickzy/shared/permissions` (one source for server + web); shared optional `WorkspaceHeader` schema. Web: Settings › **API tokens** (create with name/expiry/grouped scopes, secret shown once with Copy, list by prefix with last used/expiry/scopes, revoke with confirm; admins only) | 12 server integration tests (shown once + hashed at rest, header-less auth + last_used, scope enforcement + audit actor, cannot mint, cross-workspace header 404, user-only 403, Origin rules, forged/unknown 401, expiry, admin-only + tenant isolation, revoke immediate, immutable hash/scopes) + 5 jsdom tests (scope list == TOKEN_SCOPES) + **real-stack E2E** `e2e-api-tokens.cjs` 18/18 (create in browser → clipboard → call API from Node → scopes → revoke → 401; dark/390, axe 0) |

| T-106 | Rate limiting per **ADR-023**: `http/rate-limit.ts` — per-IP layer before auth (1200/min), tight per-IP layer on sign-in/invitation endpoints (20/min), per-token/per-user layer after auth (600/min); `RateLimit-*` headers, 429 envelope + `Retry-After`; health checks exempt; in-memory store behind `RateLimitStore` (bounded). **Security fix:** `trustProxy: true` was hard-coded (clients could spoof their IP) → `TRUST_PROXY` config (default off; hop count or proxy list; `true` refused). All limits configurable (`.env.example`) | 9 server tests (headers, per-token isolation + 429 + Retry-After + window reset, per-user, auth endpoints across emails/IPs, pre-auth token-guessing throttle, health exempt, XFF ignored by default / honoured behind configured proxy, config parsing, bounded store) + 1 web test (429 message shown) + real-process smoke (curl: 3×202 then 429 with headers; spoofed XFF still limited; `TRUST_PROXY=true` refused at startup) |

Bugs found by verification and fixed in T-105: verify page re-POSTed an empty token on remount; top bar overflowed at 768 px once the user block existed; onboarding showed prefix "XX" before typing.

Total: **149 tests passing** locally (`pnpm test`): shared 4 · db 13 · server 97 · web 35 — plus the four real-browser scripts above (all re-run green after T-106; shared helpers in `apps/web/scripts/e2e-lib.cjs`).

## Written but NOT yet verified
- T-011 CI workflow `.github/workflows/ci.yml` (Postgres 17 service). Not run on GitHub yet — first push/PR will tell.

## Not started (next, in order)
1. **T-101b** Google/Microsoft sign-in (certified OIDC client, PKCE/state/nonce, link by verified email) → completes M1. Needs Google/Microsoft OAuth client credentials for a real check (integration tests use a mocked IdP).
2. Founder review required for T-101, T-102, T-103 and T-106 (auth / access-control / abuse-protection code — engineering-workflow §5).
3. Then M2 (accounts, issues, inbox).

Known limitations (T-102): invitation emails go through the console transport until Postmark (T-303); no seat-limit/billing check on invite (billing is E29); an expired pending invitation stays listed (marked "Expired") until resent or revoked.

## Notes for the next session
- Real-stack browser checks (need dev DB migrated):
  ```bash
  pnpm --filter @tickzy/web build
  (cd apps/server && DATABASE_URL=postgres://tickzy_app:tickzy_app@localhost:5432/tickzy_dev COOKIE_SECURE=false APP_ORIGIN=http://localhost:4173 RATE_LIMIT_AUTH_PER_MIN=1000 node src/main.ts --role=all > /tmp/server.log 2>&1 &)   # all browser traffic arrives from the preview proxy (127.0.0.1)
  (cd apps/web && npx vite preview --port 4173 &)
  node apps/web/scripts/e2e-auth.cjs /tmp/server.log /tmp/shots
  node apps/web/scripts/e2e-invite.cjs /tmp/server.log /tmp/shots
  node apps/web/scripts/e2e-api-tokens.cjs /tmp/server.log /tmp/shots
  node apps/web/scripts/verify-responsive.cjs apps/web /tmp/shots /tmp/server.log
  ```
- Run the full stack: migrate dev DB, then `cd apps/server && DATABASE_URL=… AUTH_DEV_MODE=true node src/main.ts --role=all` and `pnpm --filter @tickzy/web dev` (proxies `/v1` to :3000).
- In dev the sign-in link is printed by the server (console email transport). The browser scripts are not in CI yet (need Playwright in CI — add with E2E work in M3).

## How to run locally
```bash
service postgresql start            # or any Postgres ≥16
cp .env.example .env                # adjust URLs
pnpm install
DATABASE_OWNER_URL=postgres://tickzy_owner:tickzy@localhost:5432/tickzy_dev pnpm db:migrate
psql -d tickzy_dev -c "ALTER ROLE tickzy_app PASSWORD 'tickzy_app'"
pnpm test                           # tests use DATABASE_OWNER_URL or postgres://tickzy_owner:tickzy@localhost:5432/tickzy_test
cd apps/server && DATABASE_URL=postgres://tickzy_app:tickzy_app@localhost:5432/tickzy_dev AUTH_DEV_MODE=true node src/main.ts
```
The test database is **dropped and recreated** by the test suite — never point `DATABASE_OWNER_URL` at real data when running tests.

## Known gaps / decisions pending
- Legal review of Slack API ToS (blocks M3 Slack work going to customers, not development).
- pgvector not installed in the local Postgres; needed at T-504 (CI image / Neon have it).
- Better Auth vs alternatives to be re-confirmed at T-101 (reported ownership change; ADR-006).

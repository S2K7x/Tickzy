# CURRENT STATE — Tickzy

_Last updated: 2026-11-23 (session 5)._ Read this first, then `docs/blueprint/backlog.md`. Process: `docs/process/development-pipeline.md` (we are in **Stage 5 · Build**; status per stage in `docs/process/pipeline-checklist.md`).

## Phase
Implementation: **M0 · Foundations complete** (CI green on GitHub since 2026-11-23); **M1 · Identity & access complete** (T-101, T-101b, T-102, T-103, T-104, T-105, T-106). **M2 · Core inbox** in progress (T-201, T-202 done). Planning docs are complete and approved:
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

| T-101b | Google & Microsoft sign-in per **ADR-024**: `openid-client` 6.8.9 (certified RP) — code flow + PKCE S256 + state + nonce; per-attempt secrets in a `__Host-` httpOnly cookie; `return_to` restricted to relative paths; migration `0006_user_identities.sql` (global, no grants, `auth_oauth_sign_in()`); identities keyed on Google `sub` / Microsoft `tid:oid`; email used to create/link only when the provider vouches (Google `email_verified`, Microsoft `xms_edov` — nOAuth defence); providers enabled by config, `GET /v1/auth/providers`; errors returned as `/sign-in?error=…`. Web: provider buttons only for enabled providers, return to a pending invitation, error messages. Setup guide `docs/operations/sign-in-providers.md`; mock provider `apps/server/scripts/mock-oidc.ts` | 13 server tests against a mock OIDC provider with real discovery/JWKS/token + PKCE (new user, link by verified email, unverified refused, subject-stable against email change, Microsoft without/with `xms_edov`, forged state / missing cookie / wrong nonce / wrong aud / wrong iss / replayed code, cancel, open-redirect, table not readable) + 4 web tests + **browser E2E** `e2e-oauth.cjs` 15/15 (full redirect round trips, invitation via Google, axe light/dark/390) |

| T-201 | M2 schema per **ADR-025** — migration `0007_customers_and_taxonomy.sql`: accounts (+ `account_domains`, one account per domain), contacts, contact_identities (email/slack/teams/widget; emails lowercase), teams + team_members, statuses (7 categories; one default each), labels (hierarchical, `ai_enabled`), custom_field_defs; all tenant RLS-forced with **composite foreign keys** (no cross-workspace references); `gen_ulid()` for SQL-made ids; `seed_workspace_defaults()` called on workspace creation + backfill for existing workspaces; Drizzle schema. **Deployment fix found while verifying:** migrations failed for a non-superuser owner (0002 needs SET ROLE tickzy_app on PG16+) → runner grants the owner membership or names the GRANT a DBA must run | 11 db tests (isolation per table, cross-workspace composite FKs, domain/identity uniqueness, lowercase email keys, account delete semantics, label/custom-field constraints, default statuses with valid ULIDs, idempotent seeding, one default per category, `gen_ulid` format/time) + migration test **as a non-superuser owner** incl. the backfill (proven to fail without the fix) + workspace creation seeds statuses; real dev DB backfill: 34/34 existing workspaces got 7 default statuses |

| T-202 | Issue core — migration `0008_issues_and_messages.sql`: conversations, issues (status ↔ category consistency enforced by a composite FK; `version` for optimistic concurrency), issue_labels, messages (DB CHECKs: inbound ⇔ contact, inbound public + received, **internal notes can never enter delivery**; provider-id dedupe; generated full-text vector + GIN), attachments, issue_events (append-only), `next_issue_number()` (row-locked, gap-free). **Lifecycle as pure functions** in `@tickzy/shared/lifecycle.ts` (`onMessage`, `canTransition`, `applyMessage`, `timestampsForTransition`, `countsInMetrics`/`notifies`/`isOpen`; status categories now defined there once). Server domain `modules/issues/domain.ts`: `createIssue` (number, default status, timeline + outbox), `changeStatus` (manual: custom statuses, closed is terminal, timestamps, version check) | 30 shared tests (full 7×3 state-machine table, manual-transition matrix, metrics/notify rules, timestamps) + 12 integration tests (numbering incl. 25 concurrent creations and rollback, per-workspace numbering, status/category and cross-workspace FKs, resolve/reopen/custom status/events, closed terminal, stale version 409, append-only timeline, internal-note delivery impossible, inbound rules, dedupe, full-text search, isolation) + real-process smoke on the migrated dev DB |

Bugs found by verification and fixed in T-105: verify page re-POSTed an empty token on remount; top bar overflowed at 768 px once the user block existed; onboarding showed prefix "XX" before typing.

Total: **220 tests passing** locally (`pnpm test`): shared 34 · db 25 · server 122 · web 39 — plus five real-browser scripts (last run green after T-101b; shared helpers in `apps/web/scripts/e2e-lib.cjs`). CI (lint, typecheck, tests with Postgres) green on GitHub.

## Written but NOT yet verified
- Google/Microsoft sign-in against the **real** providers: needs OAuth apps registered by the founder (`docs/operations/sign-in-providers.md`); `xms_edov` availability on the Entra app is an open item.

T-011 CI is now verified: first GitHub Actions run (push to `main`, run #1) green on 2026-11-23.

## Not started (next, in order)
1. **T-203** (accounts & contacts API + identity resolution: email-domain → account, identity graph, audited manual override), then **T-204** (issues API: list with filters/sort/keyset, get by key, patch, timeline), T-205 (messages API: reply/note), T-206 (whose-turn automation wiring `applyMessage` into message creation).
2. Founder actions: review the auth / access-control / abuse-protection code (T-101, T-101b, T-102, T-103, T-106 — engineering-workflow §5); register Google/Microsoft OAuth apps (`docs/operations/sign-in-providers.md`).
3. Discovery track (Stage 1 gate still open): interview guide and design-partner conversations.

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
  # OAuth: start the mock provider first and pass its URL as GOOGLE_ISSUER/MICROSOFT_ISSUER (+ *_CLIENT_ID=e2e-client, *_CLIENT_SECRET=e2e-secret) to the server
  (cd apps/server && node scripts/mock-oidc.ts e2e-client e2e-secret > /tmp/mock.log &)
  node apps/web/scripts/e2e-oauth.cjs /tmp/server.log /tmp/shots "$(head -1 /tmp/mock.log)"
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

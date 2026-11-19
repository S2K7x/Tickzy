# CURRENT STATE — Tickzy

_Last updated: 2026-11-19 (session 2)._ Read this first, then `docs/blueprint/backlog.md`.

## Phase
Implementation: **M0 · Foundations complete** (except CI verification on GitHub); **M1 · Identity & access** started (T-104 done). Planning docs are complete and approved:
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

Total: **59 tests passing** locally (`pnpm test`): shared 4 · db 13 · server 36 · web 6.

## Written but NOT yet verified
- T-011 CI workflow `.github/workflows/ci.yml` (Postgres 17 service). Not run on GitHub yet — first push/PR will tell.

## Not started (next, in order)
1. **T-101** real authentication (magic link + Google/Microsoft OAuth). First re-confirm ADR-006 (Better Auth ownership change reported) — compare Better Auth vs a small in-house session module; record the decision.
2. **T-103** API tokens · **T-102** invitations & members · **T-106** rate limiting · **T-105** web sign-in/onboarding.
3. Then M2 (accounts, issues, inbox).

## Notes for the next session
- Run the web checks: `pnpm --filter @tickzy/web build && (cd apps/web && npx vite preview --port 4173 &) && node apps/web/scripts/verify-responsive.cjs apps/web /tmp/shots`.
- Run the full stack: migrate dev DB, then `cd apps/server && DATABASE_URL=… AUTH_DEV_MODE=true node src/main.ts --role=all` and `pnpm --filter @tickzy/web dev` (proxies `/v1` to :3000).
- The web shell does not call the API yet (needs T-101/T-105 for real sessions).

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

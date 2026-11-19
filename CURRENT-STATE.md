# CURRENT STATE — Tickzy

_Last updated: 2026-11-19 (session 1)._ Read this first, then `docs/blueprint/backlog.md`.

## Phase
Implementation **M0 · Foundations** in progress (Phase A / MVP). Planning docs are complete and approved:
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

Total: **37 tests passing** locally against PostgreSQL 16 (`pnpm test`).

## Written but NOT yet verified
- T-011 CI workflow `.github/workflows/ci.yml` (Postgres 17 service). Not run on GitHub yet — first push/PR will tell.

## Not started (next, in order)
1. **T-009** outbox relay + pg-boss `JobQueue` + worker process role.
2. **T-010** web app shell (Vite/React/TanStack/Tailwind tokens, responsive sidebar/icon-rail/bottom-tabs, theme toggle).
3. Then M1 (T-101 Better Auth …).

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

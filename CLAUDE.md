# CLAUDE.md — Tickzy

Tickzy is a B2B customer support platform (Slack Connect, email, chat; account-centric; trustworthy AI). This file tells coding agents how to work in this repository.

## We follow a defined development pipeline
All work follows the **Tickzy Development Pipeline** — read it before starting any task:
- [`docs/process/development-pipeline.md`](docs/process/development-pipeline.md) — the lifecycle: 1 Discovery → 2 Product definition → 3 Design → 4 Technical planning → 5 Build → 6 Verify (QA & security) → 7 Release → 8 Operate → 9 Learn & improve → (10 Retirement). It is a loop with a continuous discovery track; security/privacy is a thread through every stage; each stage has an exit gate.
- [`docs/process/pipeline-checklist.md`](docs/process/pipeline-checklist.md) — live status of every stage item. Keep it accurate.
- [`docs/process/engineering-workflow.md`](docs/process/engineering-workflow.md) — the per-task loop, branching, review rules, Definition of Ready and **Definition of Done**.

**Current position:** Stage 5 (Build), milestone **M1 · Identity & access**. Stage 1 user research / design-partner validation is still open on the discovery track — treat MVP scope as a validated-by-research hypothesis, not as customer-confirmed.

## Start of every session
1. Read [`CURRENT-STATE.md`](CURRENT-STATE.md) (what is done, verified, next, blocked).
2. Read the task in [`docs/blueprint/backlog.md`](docs/blueprint/backlog.md) and the documents it references.
3. Check the stage gate in `pipeline-checklist.md` for the stage you are working in.

## Source-of-truth documents
| Topic | File |
|---|---|
| Product strategy (vision, ICP, MVP, pricing, metrics) | `docs/strategy/product-strategy.md` |
| Requirements, stories, acceptance criteria, security & test requirements | `docs/blueprint/requirements.md` |
| Task backlog (IDs, priorities, dependencies) and traceability | `docs/blueprint/backlog.md`, `docs/blueprint/master-checklist.md` |
| API contract | `docs/blueprint/api-spec.md` |
| Architecture, decisions, database | `docs/architecture/architecture.md`, `docs/architecture/adr.md`, `docs/architecture/database.md` |
| UX, design system, responsive & accessibility rules | `docs/ux/ux-spec.md`, `design/` |
| Research evidence | `docs/research/`, index `docs/README.md` |

## Non-negotiable rules
1. Follow the approved architecture (ADRs) and design system. **Never change architecture silently** — propose an ADR first.
2. Small, independently verifiable tasks; tests written alongside the code.
3. **Never claim something works without running it** (tests, real-process smoke test, real-browser check for UI). Report failures honestly.
4. Every tenant table: `workspace_id`, RLS enabled + forced, isolation tests. All tenant queries go through `withWorkspace()`.
5. Never edit an applied migration file; add a new one (expand → migrate → contract).
6. No fake data in the product UI; unbuilt screens say so.
7. Security in every change: validate input (zod), no secrets in code or logs, audit admin actions, SSRF-guard outbound URLs.
8. Update `CURRENT-STATE.md`, the backlog/master checklist and `pipeline-checklist.md` after every meaningful change.
9. Never duplicate existing functionality — search first.
10. Prefer reliability and maintainability over speed.

## Commands
```bash
service postgresql start                      # local Postgres ≥16 (tests drop/recreate the test DB)
pnpm install
pnpm lint && pnpm typecheck && pnpm test      # required before every commit
DATABASE_OWNER_URL=postgres://tickzy_owner:tickzy@localhost:5432/tickzy_dev pnpm db:migrate
cd apps/server && DATABASE_URL=postgres://tickzy_app:tickzy_app@localhost:5432/tickzy_dev AUTH_DEV_MODE=true node src/main.ts --role=all
pnpm --filter @tickzy/web dev                 # web app (proxies /v1 to :3000)
```
Server code runs as TypeScript directly on Node 22 (type stripping): no enums, namespaces or constructor parameter properties (`erasableSyntaxOnly`), import with `.ts` extensions.

## Git
Work on the session's feature branch; small commits; CI (lint, typecheck, tests with Postgres) must pass. Do not push to `main` without explicit permission.

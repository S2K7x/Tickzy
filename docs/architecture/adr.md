# Architecture Decision Records

Format: Context → Options → Decision → Consequences. Status: **Accepted** unless noted. Date 2026-11-19. Evidence links point to research docs.

## ADR-001 Modular monolith in one repo
- **Context:** solo developer; domain has many transactional cross-module operations (message → issue → SLA → assignment).
- **Options:** microservices; modular monolith; serverless functions.
- **Decision:** modular monolith (TypeScript) with process roles (api, ingest, worker, ai). Lint-enforced module boundaries; communication via services + domain events.
- **Consequences:** fastest iteration, single deploy; must police boundaries; extraction later possible (ingest/realtime). [E: research/architecture-research/saas-architecture.md §1]

## ADR-002 TypeScript on Node.js 22 LTS, pnpm workspaces
- **Options:** TS/Node, Go, Elixir, Rails, Python.
- **Decision:** TypeScript end-to-end (shared zod contracts, best LLM/MCP SDK ecosystem, one language for a solo dev). Strict `tsconfig`, ESM.
- **Consequences:** CPU-heavy work (embeddings) is offloaded to providers; Go/Elixir realtime gateway remains an option. [E: technology-options.md §1]

## ADR-003 Fastify + zod + OpenAPI for the HTTP layer
- **Options:** Fastify, Hono, NestJS, Express, tRPC-only.
- **Decision:** Fastify 5 (performance, mature plugin ecosystem: websocket, rate-limit, cookie, swagger) with zod schemas (`fastify-type-provider-zod`) generating OpenAPI 3.1. REST `/v1`, date header versioning (`Tickzy-Version`), cursor pagination, `Idempotency-Key` for POST, error envelope `{error:{code,message,request_id}}`.
- **Consequences:** public contract from day one; SDK generation; Nest-style DI not used (plain factories).

## ADR-004 PostgreSQL as the single datastore (Neon first)
- **Options:** Postgres (Neon / Supabase / RDS / Crunchy), MySQL+Vitess.
- **Decision:** PostgreSQL 17 (CI uses 16+ compatible SQL). Hosting: **Neon** during solo stage (cheap, branching, pgvector); migration path to RDS/Aurora documented. Same DB stores queue (pg-boss), outbox, vectors (pgvector), full-text (tsvector).
- **Consequences:** one backup/restore story; watch connection limits (use pooled connections); move vectors/search out only with evidence. [E: technology-options.md §3; Neon vs RDS cost notes in architecture.md §11]

## ADR-005 Shared schema + RLS + tenant directory
- **Decision:** `workspace_id` on all tenant rows, RLS policies keyed on `app.workspace_id` (transaction-local), app role without BYPASSRLS, prefixed ULID ids, per-workspace issue numbers; tenant directory table maps workspace → region/cell.
- **Consequences:** every query runs inside `withWorkspace(tx)`; mandatory RLS isolation tests in CI. [E: saas-architecture §2; zendesk.md §4]

## ADR-006 Authentication: Better Auth core + WorkOS for enterprise SSO
- **Options:** fully custom; Better Auth (OSS library, own DB); Clerk/Auth0 (hosted); WorkOS (enterprise SSO/SCIM).
- **Decision:** Better Auth for sessions, magic links, Google/Microsoft OAuth, organizations-as-workspaces (data in our Postgres). WorkOS for SAML + SCIM at GA (per-connection cost passed on only on Business/Enterprise usage; SAML included on Team as strategy requires — revisit cost at GA).
- **Consequences:** no per-MAU vendor lock; SAML completeness of Better Auth disputed, hence WorkOS. *Risk:* Better Auth ownership change (reported acquisition by Vercel) — keep an auth interface so it can be replaced. [E: search results in architecture.md sources]

## ADR-007 Background jobs: pg-boss on Postgres, behind a `JobQueue` interface
- **Options:** pg-boss, graphile-worker, BullMQ (Redis), Temporal, Inngest, Trigger.dev, Hatchet, DBOS.
- **Decision:** pg-boss (transactional enqueue with business data, retries, scheduling, singleton keys, no extra infra). Durable workflows are modelled as persisted state machines on top. Interface allows Temporal/Hatchet later.
- **Consequences:** queue load shares the DB — monitor; partition job tables / move to dedicated instance at scale. [E: saas-architecture §4]

## ADR-008 Realtime: WebSocket invalidation via Postgres NOTIFY; Redis later
- **Options:** sync engine (Zero/Electric), managed pub/sub (Ably/Pusher), Centrifugo, self-built WS.
- **Decision:** self-built WS on Fastify with topic auth; fan-out through `LISTEN/NOTIFY`; client refetch via TanStack Query. Zero evaluated later only if UX speed demands (Productlane lesson: costly to reverse).
- **Consequences:** simple; NOTIFY payload limits → send ids only; Redis pub/sub when >1 node.

## ADR-009 Frontend: Vite + React 19 + TanStack Router/Query + Tailwind v4; help center later on SSR
- **Options:** Next.js 16 for everything; SPA + separate SSR site; Remix.
- **Decision:** agent app as SPA (Vite, React 19, TanStack Router with typed search params, TanStack Query, TanStack Virtual, React Aria Components for accessible primitives, Tailwind CSS v4 with CSS-variable tokens from the design system, Tiptap editor, cmdk palette). Public help center/portal will be a separate SSR app (Next.js or Astro) at GA.
- **Consequences:** no SSR complexity in the app; same API; mobile = responsive web (PWA) first, native later. [E: technology-options.md §2]

## ADR-010 ORM: Drizzle
- **Options:** Drizzle, Kysely, Prisma.
- **Decision:** Drizzle ORM + drizzle-kit migrations (SQL files reviewed in git), raw SQL allowed for RLS policies and hot paths.
- **Consequences:** SQL-transparent, works with `SET LOCAL`; migrations are plain SQL.

## ADR-011 SLA engine: deterministic recompute + indexed `due_at` scanner
- **Decision:** SLA targets are recomputed from the issue timeline and business schedules (pure function, unit-tested) on relevant events; persisted `due_at`, `consumed_ms`, `state`; scanner job emits warning/breach once. Semantics per Plain (time consumed never changes, remaining follows current hours, finished targets final, multi-schedule any-open) plus Pylon's follow-up metric. [E: plain.md §5; pylon.md §5]

## ADR-012 Channel adapter interface; Slack via Events API; Marketplace early
- **Decision:** all channels implement `normalize / segment / deliver / sync / limits`. Slack ingestion by Events API (HTTP), never history polling for live traffic; lazy backfill budgeted by rate limits; submit to Slack Marketplace as soon as 10 installs exist; provenance tagging for Slack data. [E: communication-channels.md §1, §7]

## ADR-013 LLM gateway with route-based model selection; provider fakes in tests
- **Decision:** internal gateway (no heavy agent framework), structured outputs, prompt caching, fallbacks, metering, OTel spans. Default provider Anthropic, fallback OpenAI; BYO key later; deterministic fake provider for dev/CI. [E: ai-architecture.md §2, §4, §10]

## ADR-014 Retrieval in Postgres (pgvector HNSW + tsvector), external reranker
- **Decision:** hybrid search inside Postgres with RRF fusion; reranking via provider API; embeddings model recorded per chunk. Re-evaluate dedicated vector DB beyond ~20M chunks. [E: ai-architecture.md §5]

## ADR-015 Email: Postmark inbound + outbound behind `EmailTransport`
- **Decision:** Postmark for MVP (inbound webhook JSON, good deliverability, DKIM/Return-Path per customer domain); SES as future transport. Threading via Message-ID/References + reply token address.

## ADR-016 Hosting: Fly.io + Neon + R2 for solo stage, containerised for AWS later
- **Decision:** see architecture.md §11; static egress IPs on Fly; regions US (MVP) and EU (GA).
- **Consequences:** low cost/ops; compliance (SOC 2) achievable on these vendors (all SOC 2) — re-evaluate AWS at Series A / enterprise demand.

## ADR-017 Testing: Vitest + real Postgres + Playwright
- **Decision:** Vitest for unit/integration; integration tests hit a real Postgres (CI service container, local cluster) with migrations applied; RLS isolation suite mandatory; Playwright E2E from M3.

## ADR-018 IDs: prefixed ULIDs
- **Decision:** `<prefix>_<26-char ULID>` (e.g., `ws_01J…`, `iss_01J…`), generated in app; sortable, URL-safe, globally unique (shard-movable). Human issue numbers per workspace (`TKZ-123` style key + counter).

## ADR-019 Implementation amendments from M0 (2026-11-19)
Recorded so no architectural change is silent:
1. **Migrations are hand-written SQL** (`packages/db/migrations/*.sql`) applied by our own checksum-verifying runner (`packages/db/src/migrate.ts`), not generated by drizzle-kit. Reason: roles, RLS policies and SECURITY DEFINER functions are first-class and drizzle-kit does not model them. Drizzle remains the query builder; `schema.ts` mirrors the SQL. (Amends ADR-010.)
2. **TypeScript pinned to 5.9.x** (7.x native compiler is new and typescript-eslint support lags). Revisit at M2.
3. **No build step for the server**: Node 22 runs `.ts` via type stripping; `erasableSyntaxOnly` enforces compatible syntax (no enums/parameter properties/namespaces). Imports use `.ts` extensions.
4. **Two SECURITY DEFINER entry points** (`my_memberships()`, `upsert_user()`) are the only cross-tenant paths available to the runtime role; any new one requires an ADR entry and tests.
5. **Non-members get 404** for workspace-scoped requests (existence is not disclosed); 403 only for members lacking a permission.

## ADR-020 Job queue schema ownership and outbox relay (T-009, 2026-11-19)
- **Context:** pg-boss installs its own schema with `CREATE SCHEMA IF NOT EXISTS`, which needs database-level CREATE; at runtime it creates one partition table per queue, which needs ownership of the parent table. The runtime role must not get database-level CREATE.
- **Decision:** the migration runner installs pg-boss's schema (`getConstructionPlans('pgboss')`) with the owner role and then transfers ownership of every object in `pgboss` to `tickzy_app`. The `pgboss` schema contains queue metadata only — never tenant data. The relay claims events through a single SECURITY DEFINER function `claim_outbox(limit)` (FOR UPDATE SKIP LOCKED) and enqueues jobs **in the same transaction** via pg-boss's `db` executor, with deterministic job ids (UUID derived from event id + queue) so replays cannot duplicate jobs. A statement-level trigger `NOTIFY tz_outbox` wakes the relay; a 5 s poll is the backstop.
- **Consequences:** at-least-once delivery, no lost events, no duplicate jobs per (event, queue); consumers must still be idempotent. pg-boss upgrades run inside the schema the app role owns. Process roles: `--role=api|worker|all` (default `all` for the solo stage).
- **Also fixed:** test utilities no longer change the cluster-wide `tickzy_app` password to a test-only value (it broke a dev server sharing the cluster); both use `TICKZY_APP_PASSWORD` (default `tickzy_app`).

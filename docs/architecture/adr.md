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

## ADR-021 Authentication core built in-house (amends ADR-006) — 2026-11-23
- **Context:** ADR-006 chose Better Auth for sessions/magic links/OAuth, to be re-confirmed at T-101. Findings: (1) Better Auth remains MIT but was acquired by Vercel in July 2026, shifting roadmap governance ([Vercel](https://vercel.com/blog/vercel-acquires-better-auth), [The New Stack](https://thenewstack.io/vercel-acquires-better-auth/)); (2) it owns its own `user/session/account/verification` tables through its DB adapter, which conflicts with our RLS-protected `users` table, prefixed ULIDs and "only narrow SECURITY DEFINER entry points cross tenants" rule (ADR-019 §4); (3) the Lucia project now recommends implementing sessions directly from its guide rather than using a library ([lucia-auth.com](https://lucia-auth.com)).
- **Decision:** implement the authentication core in `apps/server/src/modules/auth`:
  - **Sessions:** token `<id>.<secret>` (random, base32), only `SHA-256(secret)` stored; constant-time comparison; httpOnly + SameSite=Lax + Secure cookie `tz_session`; 30-day lifetime with sliding renewal; revocation per session and per user.
  - **Magic links:** single-use, 15-minute tokens stored hashed; the email link opens the web app, which POSTs the token (email link scanners cannot consume it via GET); identical response for known/unknown emails (no enumeration); per-email issuance limit.
  - **Database access only through SECURITY DEFINER functions** (`auth_*`); the runtime role has no direct grants on `sessions`/`login_tokens`.
  - **CSRF:** cookie-authenticated mutating requests must carry an `Origin` in the configured allow-list (SEC-2). Bearer-token requests are exempt.
  - **OAuth (Google/Microsoft)** is split into task T-101b using a certified OpenID Connect client library (to be chosen then; Arctic's maintenance status was unclear at research time).
  - **Enterprise SSO/SCIM** stays on WorkOS (ADR-006 unchanged for that part).
- **Consequences:** small, fully tested auth surface we control; we own security of this code → mandatory founder review (engineering-workflow §5) and inclusion in the threat model.

## ADR-022 API tokens and the cross-tenant entry-point registry (T-102, T-103) — 2026-11-23
- **Context:** FR-1.6 needs scoped integration tokens; api-spec says the token implies its workspace. Bearer authentication happens before any tenant is known, and invitation links are opened by people who are not members yet — both need cross-tenant lookups, which ADR-019 §4 says must be recorded.
- **Decision (tokens):**
  - Tokens are **owned by the workspace**, not a person (they survive the creator leaving); only admins (`developers:manage`) list, create and revoke them. Format `tkz_live_<id>.<secret>` (120-bit id, 256-bit secret, base32); only `SHA-256(secret)` is stored; shown once; prefix `tkz_live_<6 chars>` displayed for recognition. Optional expiry 30/90/365 days.
  - **Scopes** are a non-empty subset of the permission matrix minus `developers:manage` (`TOKEN_SCOPES` in `@tickzy/shared/permissions`, enforced again by a DB CHECK) — a token can never mint tokens. Endpoints that need no specific permission (e.g. list members) are readable by any token of the workspace, like any member.
  - A token request is a **workspace principal**: no user id; `requireMember` takes the workspace from the token (a conflicting `Tickzy-Workspace` header → 404) and checks scopes instead of a role; audit rows use `actor_type='api_token'`, `actor_id=tok_…`. User-only endpoints (sessions, my workspaces, create workspace, accept invitation) answer 403 to tokens. Invalid/revoked/expired tokens → 401 (never treated as anonymous). Bearer requests skip cookie CSRF rules but still honour the Origin allow-list when an Origin is sent.
  - Hash, scopes and workspace are immutable (column-level UPDATE grant on `revoked_at`, `name` only). `last_used_at` is written at most once a minute.
- **Cross-tenant SECURITY DEFINER registry (runtime role):** `my_memberships()`, `upsert_user()` (0001) · `claim_outbox()` (0002) · `auth_*` (0003) · `invitation_preview(token_id, hash)`, `accept_invitation(token_id, hash, …)` (0004 — token is the capability; accept requires the signed-in user's email to match) · `api_token_lookup(token_id)`, `api_token_touch(id)` (0005) · `auth_oauth_sign_in(…)` (0006, ADR-024) · `search_message_hits(…)`, `search_issue_title_hits(…)` (0010, ADR-028; owned by `tickzy_system`). Each has integration tests; any addition updates this list.
- **Consequences:** integrations work today against every existing endpoint; issue/account scopes take effect as those APIs ship. Rate limiting per token arrives with T-106.

## ADR-023 Rate limiting and client-IP trust (T-106, SEC-9) — 2026-11-23
- **Context:** api-spec promises `RateLimit-*` headers and 600 req/min per token; sign-in and invitation endpoints send email or look up secrets without authentication. Architecture keeps Redis optional until M5. The server also had `trustProxy: true` hard-coded, which lets any client choose its IP via `X-Forwarded-For` — fatal for per-IP limits.
- **Decision:**
  - Three fixed one-minute layers: **per IP** on every request *before* authentication (1200/min; throttles floods and token guessing), **per IP on sensitive public endpoints** (`POST /v1/auth/magic-link`, `/verify`, `/v1/invitations/preview`, `/accept`: 20/min; on top of the per-email magic-link limit), **per principal** after authentication (API token or user, 600/min). `/healthz` and `/readyz` are exempt. All limits are config (`RATE_LIMIT_*`).
  - Responses carry `RateLimit-Limit/Remaining/Reset` (most specific layer reached); 429 uses the standard error envelope (`rate_limited`) plus `Retry-After`.
  - **In-memory store per process** behind a `RateLimitStore` interface (bounded: expired windows are swept). With N API nodes the effective limit is up to N×; acceptable for the solo/single-node stage. Move to a shared store (Postgres or Redis per ADR-0xx at M5) before running more than one API node.
  - **Client IP:** `TRUST_PROXY` config — `false` (default, socket address), a hop count, or proxy addresses/CIDRs. `true` is refused at startup.
- **Consequences:** predictable limits with no new infrastructure; local browser suites run behind the Vite preview proxy (all traffic is 127.0.0.1), so they raise `RATE_LIMIT_AUTH_PER_MIN`.

## ADR-024 Google & Microsoft sign-in with openid-client; identity linking rules (T-101b) — 2026-11-23
- **Context:** ADR-021 split OAuth into T-101b "with a certified OpenID Connect client library". Microsoft Entra's `email` claim is admin-editable and unverified, and apps that key or link accounts on it are vulnerable to takeover ("nOAuth"); Microsoft recommends keying on `tid`+`oid` and using the optional `xms_edov` claim before trusting an email ([Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/migrate-off-email-claim-authorization)). Entra's `/common` endpoint publishes a templated issuer (`…/{tenantid}/v2.0`).
- **Decision:**
  - **Library:** `openid-client` 6.x (panva; certified OpenID RP — Basic, FAPI 1.0/2.0), pinned to a release ≥2 weeks old (6.8.9). It validates ID-token signature, `iss` (Entra template resolved from the token's `tid`), `aud`, `exp`, `nonce`. Flow: authorization code + PKCE S256 + `state` + `nonce`; confidential client (client secret).
  - **Per-attempt secrets** (state, nonce, PKCE verifier, return path) live in an httpOnly, SameSite=Lax, `__Host-` cookie (10 min), so subdomains cannot plant one (login CSRF). `return_to` accepts only same-app relative paths (no open redirect). Redirect URIs use the public web origin (`APP_ORIGIN/v1/auth/oauth/{provider}/callback`).
  - **Identity table** `user_identities (provider, subject)` — global, RLS forced, no grants; only `auth_oauth_sign_in()` (SECURITY DEFINER; added to the ADR-022 registry). Subject = Google `sub`; Microsoft `tid:oid`.
  - **Linking rules:** a known identity always maps to its user (provider email changes never re-key or move it). A new identity may find-or-create a user by email **only if the provider vouches for the email**: Google `email_verified === true`; Microsoft `xms_edov === true`. Otherwise the sign-in is refused (`email_unverified`) and the user is told to use an email link.
  - Providers are enabled per deployment by config; the sign-in page shows only enabled ones (`GET /v1/auth/providers`). Non-https issuers are accepted only on localhost and refused in production config.
- **Consequences:** no email-based takeover through either provider. Microsoft users in tenants where `xms_edov` cannot be enabled must use magic links (risk recorded in `docs/operations/sign-in-providers.md`). Real-provider verification needs production OAuth apps (founder action); automated tests use a mock OIDC provider with real discovery/JWKS/token endpoints and PKCE checks.

## ADR-025 M2 data-model conventions and migration-role requirements (T-201) — 2026-11-23
- **Context:** M2 adds the first tenant tables that reference each other (contacts → accounts, team members → memberships, label parents). PostgreSQL checks foreign keys without RLS, so a plain `account_id REFERENCES accounts(id)` would let a row in workspace B point at workspace A's account if the id leaked. Separately, verifying the 0007 backfill as a **non-superuser** owner (as on a managed production database) showed migration 0002 cannot run there: `CREATE SCHEMA … AUTHORIZATION tickzy_app` and the pg-boss ownership transfer require `SET ROLE tickzy_app` on PostgreSQL 16+. Local and CI use a superuser owner, which hid it.
- **Decision:**
  1. **Composite foreign keys** for every reference between tenant tables: `(workspace_id, x_id) REFERENCES x (workspace_id, id)`, with `UNIQUE (workspace_id, id)` on targets (added to `memberships`). Isolation tests assert cross-workspace references fail even with a known id.
  2. **Account domains** in `account_domains` (PK `(workspace_id, domain)`): FR-4.1 allows several domains; FR-4.2 auto-mapping needs one account per domain. Contact emails live only in `contact_identities` (lowercased), the single source for identity matching.
  3. **IDs generated in SQL** use `gen_ulid()` (same ULID format as `newId`, ADR-018). **Workspace defaults** (one default status per category) come from one function, `seed_workspace_defaults()` (SECURITY INVOKER, tenant-scoped), called at workspace creation and by migration backfills. Backfills that must see all tenants lift `FORCE ROW LEVEL SECURITY` inside the migration transaction only.
  4. **Migration role:** the runner ensures the migrating role can act as `tickzy_app` before each migration (`GRANT tickzy_app TO <owner>`; possible for the role that created `tickzy_app`, which holds ADMIN on it), else fails with the exact GRANT for a DBA. Production owner must have `CREATEROLE` (creates `tickzy_app`) and own the database. A test runs all migrations, including a backfill, as a non-superuser owner.
- **Consequences:** cross-tenant references impossible at the database level; first production deploy on a managed Postgres no longer fails at 0002; database.md conventions updated.

## ADR-026 Outbound delivery pipeline (T-205, implements part of ADR-012) — 2026-11-23
- **Decision:** a reply is written to `messages` with `delivery_state = pending` only when its conversation's channel has a registered `ChannelAdapter` (`modules/messages/delivery.ts`; only `deliver` exists until M3 brings normalize/segment/sync/limits). The same transaction writes an outbox `message.created` event; the worker's `deliver-message` queue calls the adapter and records `sent` + the provider message id. Errors retry with backoff (`QUEUE_RETRY_LIMIT`); the last failure sets `failed` and emits `message.delivery_failed`; `POST /v1/messages/{id}/retry` re-queues. The handler is idempotent (only public + pending messages are sent; the update is conditional on `pending`). Channels without an adapter (`api`, `ui`) deliver nothing.
- **Internal notes (FR-3.5)** are protected three times: DB CHECK (no delivery state on internal messages), the API never queues them, and the worker refuses anything not public — with a test that the adapter is never called.
- **One registry** instance is shared by the API (decides `pending`) and the worker (delivers), created in `main.ts`.
- **Consequence:** adapters must be safe to retry (a crash after the provider accepted but before `sent` is recorded can re-send once; providers' idempotency keys — Slack `client_msg_id`, email Message-ID — are used by the M3 adapters to dedupe).
- **ADR-020 amendment (T-206, 2026-11-23):** deterministic job ids are now derived from `(outbox id, event created_at, queue)`, not `(outbox id, queue)`. Found while chasing an intermittent test failure: an outbox id that is reused (sequence reset, database restored from a backup) produced the id of an older job, and pg-boss silently ignored the new job as a duplicate — the event was never processed. Replays of the same event still dedupe. A regression test reproduces the drop with the old scheme. Test databases now also drop the `pgboss` schema between runs.

## ADR-027 Whose-turn automation and inbound ingestion entry point (T-206) — 2026-11-23
- **Decision:** one domain step, `applyMessageToIssue()` (issues/domain.ts), applies the pure rules of `@tickzy/shared/lifecycle` to an issue inside the message's transaction: status (the category's default status), first response / last message timestamps, version. Automatic transitions are timeline events with `actor_type = system`, the rule's `reason` and the triggering `message_id` (FR-3.2), plus an outbox `issue.status_changed`. Outbound replies (messages API) and inbound customer messages both use it.
- **Inbound entry point** `recordInboundMessage()` (messages/inbound.ts) is what channel ingestion (M3) calls: dedupe by provider message id → `resolveContact` → find/open the conversation by thread key → the thread's current issue (issue of its latest message) or a new Triage issue titled from the first meaningful line → reopen rules: resolved → waiting_on_us; closed → a **new follow-up issue** linked both ways (`issue.followup_of` / `issue.followup_opened`), later thread messages continue on it; ignored → unchanged and `notify: false` on the event. Concurrent duplicates of one provider message are rejected by the unique index; ingestion retries and then dedupes.

## ADR-028 Full-text search under row-level security (T-207) — 2026-11-23
- **Context:** FR-3.8 needs p95 < 300 ms on 1M messages. Measured during T-207: as the RLS-bound runtime role, PostgreSQL never uses the GIN full-text index — `@@` (`ts_match_vq`) is not LEAKPROOF, so row-level security evaluates it *after* the tenant policy, as a filter over every message of the workspace (1.3 ms with the index vs 47 ms at 100k messages, growing linearly ≈ 470 ms at 1M). Marking catalog operators LEAKPROOF needs a superuser and is unavailable on managed databases.
- **Decision:** the full-text step runs in two narrow `SECURITY DEFINER` functions, `search_message_hits(query, internal_only, contacts[], users[], limit)` and `search_issue_title_hits(query, limit)`, owned by **`tickzy_system`** (NOLOGIN, BYPASSRLS — the role planned in database.md for audited platform work). They filter `workspace_id = app_workspace_id()` explicitly (no context → no rows) and return only ids and ranks; the API then loads issues **under RLS** with the operator filters (primary-key and text-equality lookups are leakproof, so indexed). Added to the cross-tenant registry (ADR-022). If the migration role cannot create a BYPASSRLS role (some managed Postgres), the functions stay owned by it: results stay correct (RLS applies) but without the index; `search_index_available()` reports the mode and the server logs a warning at startup.
- **Query language:** parsed in `@tickzy/shared/search` — text and "phrases" (and `-negation`) go to `websearch_to_tsquery('simple', …)`; operators `from:`, `account:`, `status:`, `is:` (open, unassigned, mine, internal), `channel:`, `priority:`; unknown operators stay text. Ignored issues are excluded unless `status:ignored`. Snippets come from `ts_headline` with control-character markers the client renders as `<mark>` (never HTML).
- **Consequences:** measured at 100k messages: worst p95 29 ms (from 103 ms); at 1.25M messages / 125k issues (1.5 GB): worst p95 111 ms (two-term OR query), typical 37–50 ms — within the 300 ms target. Production database needs a migration role able to create `tickzy_system` (superuser or BYPASSRLS) for indexed search — added to the deployment checklist.

## ADR-029 Strict security headers and Content-Security-Policy (T-110, threat model TM-4) — 2026-11-24
- **Context:** the threat model found no security headers at all. The web app loaded Inter from Google Fonts (every visitor's IP sent to Google — a GDPR concern in the EU) and applied the theme with an inline script; cmdk's dialog (Radix) injects `<style>` elements for scroll locking.
- **Decision:**
  - **Web app** (`apps/web/security-headers.ts`, the single definition): `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` + `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `COOP: same-origin`. **No `unsafe-inline`, no `unsafe-eval`, no third-party origins.** `vite preview` serves the build with these headers so every browser suite runs under the real policy; production hosting must send the same headers (`docs/operations/security-headers.md`).
  - **API**: every response gets `default-src 'none'; frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `CORP: same-origin`, `Cache-Control: no-store` (unless a route sets its own), and HSTS (2 years, includeSubDomains) when served over https.
  - Consequences for the code: fonts are self-hosted (`@fontsource-variable/inter`); the pre-paint theme script is a same-origin file (`public/theme-init.js`); dialogs use our `Modal` (scroll lock through the CSSOM, which CSP allows) — the command palette uses cmdk's `Command` inside it instead of cmdk's Radix dialog.
- **Rule for future work:** no inline scripts, no libraries that inject `<style>`/`<script>` at runtime, no third-party scripts, fonts or images in the agent app. A new need goes through an ADR amendment (e.g. a hash or nonce for one known snippet). The chat widget (T-308) is a separate bundle on its own origin with its own policy. `e2e-csp.cjs` fails on any violation, third-party request or missing font.

## ADR-030 Security scanning in CI (T-112, SEC-13, threat model TM-10) — 2026-11-24
- **Context:** CI ran lint, typecheck and tests only. The first audit found a **high** advisory in production code: `ws` (under `@fastify/websocket`, the realtime gateway) — GHSA-96hv-2xvq-fx4p, memory-exhaustion DoS from tiny fragments — plus a moderate one (GHSA-58qx-3vcg-4xpx). GitHub release downloads are not reachable from the development sandbox, so scanners had to be installable from the npm registry to be run and verified locally (CLAUDE.md rule 3).
- **Decision:** three gates on every push, all also runnable locally:
  1. **Secrets** — `pnpm secrets`: secretlint (recommend preset: Slack, GitHub, AWS, GCP, npm, private keys, DB URLs, …) over every tracked file + `scripts/check-private-keys.mjs` (any PEM private-key header, because secretlint's key rule needs ≥100 base64 chars and misses short Ed25519 keys). Only `postgres://…@localhost|127.0.0.1/…` connection strings are allowed (documented local dev credentials).
  2. **Dependencies** — `pnpm audit:deps` fails on high/critical. Fixes for transitive packages go in `pnpm-workspace.yaml` `overrides` with the advisory ids, pinned to a version released ≥ 2 weeks ago (now `ws` 8.22.2), removed once dependants' own ranges resolve to a patched version.
  3. **SAST** — `eslint-plugin-security` in the normal lint, which now runs with `--max-warnings 0`; `detect-object-injection` is off (flags every `obj[key]`; keys are typed and zod-validated). Individual suppressions must carry a reason in the line comment (current: two bounded regexes, the domain regex measured linear on 50k-char inputs and length-capped first, and the migration runner reading its own directory).
- **Verified:** planted Slack/GitHub/AWS tokens, a non-local Postgres URL and RSA + Ed25519 private keys each fail `pnpm secrets`; a planted `eval(input)` / `exec(input)` fails lint; the clean tree passes.
- **Limits (accepted for now):** pattern-based secret detection scans the current tree, not git history (a history scan, e.g. gitleaks, can be added once CI can download it — its GitHub Action needs a licence for organisation repos); no CodeQL (needs GitHub Advanced Security for private repositories); `pnpm audit` depends on the npm advisory database. Re-evaluate before GA together with the external pentest.

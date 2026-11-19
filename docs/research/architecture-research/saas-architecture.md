# SaaS Architecture Research (multi-tenancy, events, realtime, jobs, webhooks, search)

- **Research date:** 2026-11-19 · **Missions:** M23 (SaaS architecture), M24 (data modelling), M28 (security & scalability)
- **Primary evidence (how incumbents actually built it):**
  - Zendesk: data centres → **pods** (self-sufficient app+DB stacks) → MySQL clusters (primary + 2 replicas) → **hundreds of logical shards**, accounts assigned to shards, big tenants get dedicated shards, shards rebalanced across pods — VERIFIED ([Zendesk technical architecture](https://support.zendesk.com/hc/en-us/articles/4408832509338-Zendesk-Support-scalability-and-performance-Technical-architecture)); event store Kafka → MySQL → S3 tiering ([analysis](https://royondata.substack.com/p/unpacking-zendesk-mysqls3-tiered)).
  - Intercom: **Rails monolith** on MySQL; vertical scaling → functional sharding (2014; conversations table split out) → Aurora (2015) → **custom customer sharding** (2020) → **Vitess via PlanetScale**; 13 Aurora clusters in US; ProxySQL for connection pooling caused outages; hundreds of TB, 2M reads/s; explicit philosophy "build boring software, run less software" — VERIFIED ([Intercom engineering](https://www.intercom.com/blog/evolving-intercoms-database-infrastructure)).
  - Pylon: AWS us-west-2 + eu-central-1, tenant pinned to one region, in-region AI inference, static egress IPs — VERIFIED ([Pylon security](https://docs.usepylon.com/pylon-docs/security/security-overview.md)).
  - Plain: GraphQL API is the product's own API (UI/API parity), UK/US regions, at-least-once webhooks with idempotency id, request signing + mTLS — VERIFIED ([Plain docs](https://www.plain.com/docs/llms.txt)).
  - Chatwoot (OSS): Rails monolith + Postgres + Redis/Sidekiq + ActionCable websockets — PARTIALLY VERIFIED (public repo knowledge).
  - Productlane (a Linear-centric support tool): Replicache sync engine → initial sync took minutes as workspaces grew to thousands of threads → migrated to **Zero** (query-scoped partial sync) in Apr 2026; cost several months — PARTIALLY VERIFIED (vendor-co-authored post: [Productlane blog](https://roadmap.speakeasy.com/blog/zero-migration)).

---

## 1. Modular monolith vs microservices

| Criterion | Modular monolith | Microservices |
|---|---|---|
| Team size fit | 1–50 engineers | 50+ with platform team |
| Transactions across ticket/SLA/assignment | trivial (one DB tx) | sagas/outbox everywhere |
| Velocity early | highest | low (infra tax) |
| Independent scaling | via separate *process roles* of the same codebase (web, workers, ingestion, realtime) | per service |
| Evidence | Intercom, Zendesk (Rails monoliths for >10 yrs at massive scale), Shopify, Chatwoot | — |

**Recommendation (high confidence):** a **modular monolith** with strict internal module boundaries (`identity`, `workspace`, `channels/*`, `conversations`, `issues`, `accounts`, `sla`, `routing`, `automation`, `ai`, `knowledge`, `analytics`, `billing`, `integrations/*`, `public-api`), deployed as several **process roles** from one codebase: `api` (HTTP/GraphQL), `ingest` (webhook receivers: Slack/Teams/email/Stripe), `worker` (jobs/workflows), `realtime` (websocket fan-out), `ai-runner` (long LLM/tool runs), `scheduler`. Extract a service only when a module has a distinct scaling/runtime profile proven in production (likely candidates: channel ingestion gateway, realtime gateway, search indexer).

## 2. Multi-tenancy

Options: (a) shared DB, shared schema + `workspace_id` everywhere; (b) schema-per-tenant; (c) DB-per-tenant; (d) **cells/pods** (groups of tenants per isolated stack).

**Recommendation:** (a) now, designed to evolve into (d):
- Every tenant-owned row has `workspace_id` (NOT NULL), all unique keys composite with it, all FKs within tenant.
- **Postgres Row-Level Security** as defence-in-depth (`SET app.workspace_id` per transaction via connection-pool-safe `SET LOCAL`), plus application-level scoping in the repository layer; automated tests that try cross-tenant access.
- Globally unique, time-ordered IDs (UUIDv7 or prefixed ULIDs like `iss_01H…`, Stripe-style) → shard-movable, no sequence collisions; human-friendly per-workspace issue numbers (`#1234`, `T-15086`) via a per-workspace counter.
- A **tenant directory** (workspace → region → cell) consulted by edge routing from day one, even with one cell per region. Enables EU/US residency (Pylon offers on all plans) and later dedicated cells for enterprise (single-tenant offering, cf. Plain "single-tenant cloud").
- Avoid cross-tenant tables except global: users (identities), plans, feature flags, audit of platform staff.
- Noisy-neighbour controls: per-tenant rate limits, per-tenant job queues/concurrency keys, per-tenant AI spend caps.

## 3. Event-driven core (within the monolith)

- **Domain events** written in the same transaction as state changes to an `outbox` table (transactional outbox) → relayed to an internal bus (Postgres-backed queue initially; NATS JetStream / Kafka / Redpanda later if volume demands).
- Consumers: SLA engine, routing, automation triggers, AI triage, notifications, webhooks, search indexing, analytics.
- Use an **append-only issue timeline** (`issue_events`) as the source for UI timeline, audit, SLA recomputation and analytics — event-sourced *read side*, conventional tables for current state (no full event sourcing).
- Lesson from Plain/Pylon automation docs: define **loop prevention** (automation-caused changes don't re-trigger same-type automations), deterministic **run order**, idempotent consumers keyed by event id.

## 4. Background jobs & durable workflows

Needs: SLA timers (millions of future deadlines), wait-steps up to 1 year (Plain), retries with backoff, AI agent runs pausing for human approval, scheduled automations, bulk imports/migrations, backfills under external rate limits (Slack 1 req/min pre-Marketplace!).

| Option | Model | Infra | Fit |
|---|---|---|---|
| Postgres queues (pg-boss / graphile-worker / River(Go) / Oban(Elixir) / solid_queue(Rails)) | jobs | none extra | great start; transactional enqueue with business data |
| **DBOS** | durable workflows as library, Postgres-native | none extra | strong fit for "start simple" |
| **Hatchet** | durable tasks on Postgres, concurrency keys/fairness | service | good fit for per-tenant fairness |
| **Temporal** | durable workflows, polyglot, battle-tested | cluster or Cloud (~$200/mo+) | best for complex long-running sagas; heavier |
| Inngest / Trigger.dev | event-driven durable functions (TS) | SaaS or self-host | great DX; vendor dependency |
| Restate | durable services/journal | service | promising, newer |
(Positioning from 2026 comparisons — PARTIALLY VERIFIED: [diagrid](https://www.diagrid.io/infrastructure/10-best-temporal-alternatives-2026), [zenml](https://www.zenml.io/blog/inngest-alternatives), [automationatlas](https://automationatlas.io/guides/inngest-vs-temporal-2026-comparison/).)

**Recommendation:** start with a **Postgres-backed queue + durable-workflow library** (keeps one datastore, transactional enqueue), with an abstraction boundary so Temporal/Hatchet can replace it. **SLA timers should not be one job per deadline**: store `due_at` on SLA targets, index it, and run a ticking scanner (every ~15–30 s) that fires breach/warning events — recompute deterministically from the issue timeline when business hours change (Plain's semantics).

## 5. Realtime

Requirements: live inbox updates, presence & **collision detection** (Front), typing indicators, streamed AI drafts, chat widget messaging, multi-tab consistency, mobile.

| Approach | Notes |
|---|---|
| WebSocket gateway (self-built on Node/Go/Elixir/Rust) + Redis/NATS pub-sub | full control; must handle reconnection, backpressure, auth per channel |
| Managed pub/sub (Ably, Pusher, PubNub) / Centrifugo (OSS) | fast to ship; Centrifugo self-hostable |
| **Sync engines** (Zero, ElectricSQL, Replicache, PowerSync, Linear-style custom) | local-first UX (instant UI, offline), query-scoped partial sync; adds architectural commitment |
| Supabase Realtime / Postgres LISTEN-NOTIFY | simple; LISTEN/NOTIFY doesn't scale to high fan-out alone |

**Recommendation:** server-authoritative API + **event-driven websocket fan-out** (subscribe to `workspace:{id}:inbox`, `issue:{id}`) carrying *invalidation/patch events*, with a normalised client cache (TanStack Query or a small store) — proven, simple. **Evaluate Zero** in a spike for the inbox: the "Linear-like instant UI" is a genuine differentiator, but Productlane's experience shows sync-engine choice is costly to reverse and initial-sync size matters (B2B workspaces accumulate large histories) — must use query-scoped partial sync if adopted. Decision deferred to an explicit spike (roadmap Phase 0).

## 6. Inbound webhook & integration processing
- Dedicated `ingest` role: verify signature (Slack signing secret, Stripe, MS Graph validation tokens), **persist raw payload immediately** to an `inbound_events` table/object storage, ack in <1s (Slack requires <3s), process async with idempotency on provider event id, dead-letter queue + replay UI.
- Per-integration rate-limit budgets (token buckets in Redis) and backoff that honours `Retry-After`.
- Outbound webhooks to customers: **typed, versioned event catalogue**, HMAC signatures with timestamp (replay protection), optional mTLS, retries with exponential backoff over ≥24h, delivery logs + manual replay, endpoint auto-disable on persistent failure (contrast: Pylon only 3 attempts within ~12 s, string-typed payloads). Consider Svix (managed webhooks) vs in-house.

## 7. API architecture: REST vs GraphQL

| | REST (+ OpenAPI) | GraphQL |
|---|---|---|
| Third-party DX | universal, easy SDK generation, caching | powerful for UIs; harder rate limiting (cost analysis), caching |
| Competitors | Pylon, Zendesk, Front, Intercom (REST) | Plain (GraphQL + REST) |
| Webhooks/events alignment | natural | separate |

**Recommendation:** **resource-oriented REST + OpenAPI 3.1** as the public contract (generate TS/Python/Go SDKs, MCP server tools from the same spec), date-based versioning (`Tickzy-Version: 2027-01-15`, Stripe/Intercom style), cursor pagination, idempotency keys on POST, expandable fields, consistent errors with `request_id`. Internally the web app uses the **same public API** (Plain's parity principle) possibly via a typed RPC layer (tRPC/ts-rest/oRPC) that is generated from/aligned with OpenAPI. Offer GraphQL later only if customer demand is real.

Rate limits: per-workspace **and** per-token buckets, generous defaults (≥600 req/min), headers like Pylon/Intercom, never sell throughput (contrast: Front $200 per +100 rpm; Gorgias 2 rps; Pylon 30–300 rpm).

## 8. Search
- **Issue/message search:** Postgres FTS (tsvector, GIN) or ParadeDB `pg_search` (BM25) with per-workspace filters is sufficient for early stages; plus pg_trgm for fuzzy names/emails. Move to OpenSearch/Typesense/Meilisearch only with evidence (search is a known weakness of Plain per G2 — must be good: filters, operators like `from:`, `account:`, `status:`, saved views).
- **Semantic search / similar issues:** pgvector HNSW within the same DB (see AI doc).
- Search indexing via outbox consumers; eventual consistency target <2 s.

## 9. Caching
- Redis (or Valkey) for: rate-limit buckets, sessions/presence, realtime pub-sub, short-lived caches (context cards with TTL — Plain's customer cards are fetched on view), idempotency keys. Avoid caching tenant data cross-tenant; keys always prefixed with workspace id.
- HTTP caching/CDN for help center (public KB) & widget assets.

## 10. Files & attachments
Object storage (S3/R2/GCS) with per-workspace prefixes, pre-signed uploads/downloads, malware scanning (ClamAV/managed), image thumbnails, content-type sniffing, size limits, retention policies, encryption at rest; serve user content from a separate sandboxed domain to prevent XSS.

## 11. Security model (baseline for B2B trust — competitors all have SOC 2 II + ISO 27001)
- SSO (SAML/OIDC) + SCIM on **all paid plans** (differentiator — competitors gate them), MFA, session management.
- RBAC with permission sets (not hard-coded roles): Admin, Member, Light/Collaborator, Viewer (Pylon Viewer pattern), Integration user, custom roles; resource scopes (teams, queues, accounts).
- **Audit log** of all admin and data-access actions (exportable, SIEM streaming).
- Encryption: TLS 1.2+/1.3, AES-256 at rest, envelope encryption for secrets (integration tokens) via KMS; optional customer-managed keys for enterprise later.
- Data residency (US/EU) from launch; retention controls & deletion SLAs; message redaction (Pylon).
- Static egress IPs (customers allowlist them for context cards/webhooks — Pylon, Plain, Intercom all publish IPs).
- SSRF protection for outbound calls (block private IP ranges — Pylon does), secrets vault for automation actions (Foqal).
- Compliance roadmap: SOC 2 Type I → Type II, ISO 27001, GDPR DPA, HIPAA BAA later.

## 12. Observability
OpenTelemetry traces/metrics/logs across api/workers/ai (incl. GenAI spans with token/cost), error tracking (Sentry), structured logs with `workspace_id`/`request_id`, SLOs on: message ingestion latency (Slack→inbox p95 < 5 s), API latency, webhook delivery success, AI answer latency, SLA timer accuracy.

## 13. Open questions
- Sync-engine spike outcome (Zero vs plain websocket invalidation).
- Postgres extension availability on chosen managed host (pgvector is universal; pg_search is not).
- Whether to use Kafka-class bus before ~10k msgs/s (likely not).

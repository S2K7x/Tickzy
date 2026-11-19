# Technology Comparisons (backend, frontend, data, infra, AI tooling)

- **Research date:** 2026-11-19 · **Missions:** M25 (frontend), M26 (backend), M27 (AI infra), M23 (infra)
- **Sources:** [Next.js 16 release](https://nextjs.org/blog/next-16), [Next.js 16 coverage](https://alternativeto.net/news/2025/10/next-js-16-launches-with-turbopack-new-caching-model-react-19-2-and-devtools-upgrades), [TanStack Start vs Next.js 16](https://ecorpit.com/tanstack-start-vs-nextjs-16-production-react-2026/), [TanStack Start 1.0 report](https://tech-insider.org/tanstack-start-1-0-stable-release-2026/), [Zero migration (Productlane)](https://roadmap.speakeasy.com/blog/zero-migration), [Intercom DB evolution](https://www.intercom.com/blog/evolving-intercoms-database-infrastructure), workflow-engine roundups cited in `architecture-research/saas-architecture.md`, embedding/reranker roundups cited in `ai-research/ai-architecture.md`.
- **Method note:** Version facts are PARTIALLY VERIFIED (secondary blogs; e.g., Next.js 16 GA 2025-10-21 with Turbopack default, React Compiler stable, React 19.2; Next.js 16.2.6 May 2026 with 13 security advisories; TanStack Start 1.0 date conflicts between sources). Recommendations are judgement calls documented with trade-offs; final choices happen in `docs/tickzy/recommended-architecture.md`.

---

## 1. Backend language & framework

Selection criteria for Tickzy: (1) one language across web, API, workers and SDKs if possible; (2) strong typing for a large domain; (3) excellent Postgres tooling; (4) concurrency for websockets/ingestion; (5) AI SDK ecosystem; (6) hiring pool; (7) team velocity.

| Option | Strengths | Weaknesses | Fit |
|---|---|---|---|
| **TypeScript (Node.js/Bun) — e.g., Fastify/Hono + Drizzle/Kysely** | one language front+back; shared types/zod schemas; best LLM/SDK ecosystem (Anthropic/OpenAI/Vercel AI SDK, MCP SDK); huge hiring pool | runtime performance < Go; discipline needed for large-monolith structure | **Top candidate** |
| Go | performance, concurrency, single binaries (Libredesk), simple ops | more boilerplate for rich domain; separate language from frontend | strong for ingestion/realtime gateway later |
| Elixir/Phoenix | best-in-class realtime (channels/presence), fault tolerance, Oban jobs | small hiring pool; smaller AI ecosystem | technically excellent, staffing risk |
| Ruby on Rails | proven for helpdesks (Zendesk, Intercom, Chatwoot, Zammad), velocity | dynamic typing at scale, separate frontend language, perf | proven but less aligned with TS frontend & AI SDK |
| Python (FastAPI/Django) | AI/ML ecosystem | weaker for realtime & shared types with frontend | use only for ML services if needed |
| Kotlin/Java (Spring) | enterprise robustness | heavier, slower iteration | no |

**Leaning:** TypeScript modular monolith (Node LTS) for api/worker/ingest/ai roles; optionally a Go or Elixir realtime gateway later if websocket fan-out becomes a bottleneck.

### ORM / data access (TS)
| | Drizzle | Prisma | Kysely | MikroORM |
|---|---|---|---|---|
| SQL closeness | high | lower | highest (query builder) | medium |
| Migrations | SQL-first kit | strong | external | yes |
| RLS / `SET LOCAL` per tx | straightforward | possible but clunkier | straightforward | possible |
| Perf/edge | good | improved (Rust-free client in recent versions — UNVERIFIED) | good | ok |
**Leaning:** Drizzle or Kysely (SQL-transparent, RLS-friendly). Raw SQL for SLA/analytics hot paths.

## 2. Frontend

Requirements: complex keyboard-first inbox (virtualised lists, split panes, command palette ⌘K, shortcuts like Plain `P`, `T`, Pylon `s`), realtime updates, rich text composer with mentions/snippets/AI, embedded widget (tiny bundle), public help center (SEO), customer portal, admin settings, analytics dashboards.

| Option | Pros | Cons |
|---|---|---|
| **Next.js 16 (App Router, RSC)** | ecosystem, SSR/SEO for help center & marketing, React 19.2, Turbopack default | RSC/caching complexity for a highly interactive SPA-like inbox; frequent security advisories (13 in 16.2.6) |
| **TanStack Start / Router (+ Query)** or Vite SPA | SPA-first, type-safe routing & search params (great for filter-heavy views), simpler mental model | smaller ecosystem; 1.0 recency |
| Remix/React Router 7 | data loaders, progressive enhancement | — |
**Leaning:** split by surface: the **agent app as a Vite + TanStack Router SPA** (inbox is an app, not a document; Linear/Plain-like), the **help center + portal + marketing on Next.js** (SSR/SEO), the **widget as a separate tiny bundle** (Preact or vanilla + web components, <50 KB gz target). Validate with a spike.

UI system: Radix/React Aria primitives + Tailwind CSS + shadcn/ui-style owned components; design tokens; full keyboard and screen-reader support (React Aria has the strongest a11y semantics). Virtualisation: TanStack Virtual. Command palette: cmdk. Charts: Recharts/visx/ECharts.

State: server state in TanStack Query (or sync engine if adopted), small client state (Zustand/Jotai), URL as state for filters/views.

Rich text: **Tiptap (ProseMirror)** vs Lexical vs Plate. Needs: markdown shortcuts, @mentions, snippets/macros, inline images, code blocks, channel-aware rendering (Slack mrkdwn, Teams HTML, email HTML), collaborative drafts (Yjs) later. **Leaning:** Tiptap (mature ProseMirror ecosystem, Yjs collaboration, schema control for multi-channel conversion). Canonical message format: a **portable block AST** stored server-side, rendered per channel.

## 3. Data stores
| Need | Choice (leaning) | Alternatives |
|---|---|---|
| System of record | **PostgreSQL 17/18** (managed: AWS RDS/Aurora, Neon, Crunchy Bridge, Supabase, PlanetScale Postgres) | MySQL+Vitess (Intercom path) |
| Vector | pgvector (HNSW) | Turbopuffer/Qdrant later |
| Full-text | Postgres FTS / ParadeDB pg_search | Typesense/Meilisearch/OpenSearch |
| Cache/rate limits/pubsub | Redis/Valkey | NATS |
| Queue/workflows | Postgres-backed (pg-boss/graphile-worker/DBOS) | Temporal, Hatchet, Inngest |
| Analytics | Postgres rollups → ClickHouse/Tinybird when needed; customer warehouse sync (Snowflake/BigQuery) like Pylon | DuckDB for exports |
| Object storage | S3 / Cloudflare R2 | GCS |

Managed Postgres choice depends on extension needs (pgvector everywhere; pg_search only on some), branching for previews (Neon/PlanetScale), regional availability (EU+US), and PITR. → decision in architecture doc.

## 4. Hosting & infra
| Option | Pros | Cons |
|---|---|---|
| **AWS (ECS Fargate/EKS + RDS + ElastiCache + S3)** | what Pylon/Intercom/Zendesk use; compliance, regions, static egress IPs via NAT | ops overhead |
| Render / Fly.io / Railway | fast PaaS start | static IPs, compliance, regional control vary |
| GCP Cloud Run + Cloud SQL | simple containers | — |
| Vercel/Cloudflare for frontends | great for Next.js help center & widget CDN | not for long-running workers/websockets |
**Leaning:** AWS for core (two regions: us-east/us-west + eu-central), IaC (Terraform/OpenTofu or Pulumi), containers; CDN (CloudFront/Cloudflare) for widget & help center. A PaaS is acceptable for the very first design-partner phase only if migration path is clear.

CI/CD: GitHub Actions; preview environments per PR (DB branching); trunk-based with feature flags (OpenFeature-compatible: in-house, Unleash, GrowthBook, LaunchDarkly).

Observability: OpenTelemetry → Grafana stack (Tempo/Loki/Prometheus) or Datadog/Honeycomb; Sentry for errors; uptime/status page.

## 5. Auth
Build-vs-buy: WorkOS (SSO/SCIM/audit-log APIs — enterprise B2B focus), Clerk (DX, B2B orgs), Auth0, Stytch, or OSS (Better Auth, Ory, Keycloak). Requirements: orgs/workspaces, SAML/OIDC SSO, SCIM, MFA, magic links, Google/Microsoft sign-in, API tokens & OAuth apps for third parties, customer-portal end-user auth (JWT from customer's product). **Leaning:** own the core session/user model (library like Better Auth or custom) + **WorkOS for SSO/SCIM** so enterprise features are cheap to include on all paid plans. (Pricing to verify.)

## 6. Email providers
Postmark (deliverability, inbound parse, DX), Amazon SES (cost, scale; inbound via S3/SNS), Resend (React Email DX), SendGrid/Mailgun (mature). **Leaning:** SES for scale-economy outbound + inbound via SES receipt rules, or Postmark for both early; abstract behind an `EmailTransport` interface.

## 7. AI tooling
- SDKs: provider SDKs directly (Anthropic, OpenAI) behind an internal gateway; consider Vercel AI SDK for streaming UI helpers.
- MCP: official TypeScript MCP SDK for Tickzy's own MCP server and for MCP connectors (Pylon/Plain both ship MCP).
- Tracing/evals: Langfuse (OSS, self-host), Braintrust, Arize Phoenix, or in-house on OpenTelemetry GenAI conventions; Tickzy will also need **customer-facing** eval UX (backtests), so core eval data model must be in-house regardless.
- Embeddings/rerank: bake-off (Voyage 4 family, Cohere Embed 4 + Rerank, OpenAI text-embedding-3-large, BGE-M3 self-hosted).

## 8. Summary of leanings (to be confirmed by spikes)
TypeScript modular monolith · Postgres (+pgvector, FTS) · Redis · Postgres-backed durable jobs · REST/OpenAPI public API used by own UI · websocket invalidation (Zero spike) · Vite/TanStack SPA for agent app + Next.js for help center/portal · Tiptap composer · AWS multi-region · OpenTelemetry · WorkOS for SSO/SCIM · LLM gateway with model routing.

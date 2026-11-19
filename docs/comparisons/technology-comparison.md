# Technology Comparison (summary)

- **Last updated:** 2026-11-19 · Detail: `docs/research/technology-comparisons/technology-options.md`, `docs/research/architecture-research/saas-architecture.md`, `docs/research/ai-research/ai-architecture.md`.

| Decision | Options compared | Current leaning | Confidence | Validation needed |
|---|---|---|---|---|
| System shape | modular monolith vs microservices | modular monolith, multiple process roles | High (Zendesk/Intercom/Chatwoot evidence) | — |
| Tenancy | shared schema / schema-per-tenant / DB-per-tenant / cells | shared schema + RLS + tenant directory → cells later | High | RLS perf test |
| Backend language | TS, Go, Elixir, Rails, Python | TypeScript (Node) | Medium | team skills; perf spike for ingestion |
| ORM | Drizzle, Prisma, Kysely | Drizzle/Kysely | Medium | RLS + migrations spike |
| Public API | REST/OpenAPI vs GraphQL | REST + OpenAPI, date-versioned; UI uses same API | Medium-High | — |
| Database | Postgres vs MySQL/Vitess | Postgres 17/18 | High | managed-host choice (extensions, regions) |
| Vector/FTS | pgvector + FTS/pg_search vs dedicated | in-Postgres first | Medium | retrieval bake-off |
| Jobs/workflows | pg queues, DBOS, Hatchet, Temporal, Inngest, Trigger.dev | Postgres-backed queue + durable library, abstracted | Medium | SLA timer + approval-wait spike |
| Realtime | WS invalidation vs sync engine (Zero/Electric) | WS invalidation; Zero spike | Low-Medium | inbox prototype |
| Frontend | Next.js 16 vs TanStack/Vite SPA | SPA for agent app; Next.js for help center/portal | Medium | prototype |
| Editor | Tiptap vs Lexical vs Plate | Tiptap | Medium | multi-channel rendering spike |
| UI kit | Radix/React Aria + Tailwind | React Aria or Radix + Tailwind (owned components) | Medium | a11y audit |
| Cloud | AWS vs GCP vs PaaS | AWS, US + EU | Medium-High | cost model |
| Auth/SSO | WorkOS, Clerk, Better Auth, Ory, Keycloak | own core + WorkOS for SSO/SCIM | Medium | pricing check |
| Email | SES, Postmark, Resend | Postmark early or SES; abstracted | Medium | deliverability test |
| LLMs | Anthropic, OpenAI, Google, open-weight | multi-provider gateway; Haiku/Sonnet/Opus-class routing | Medium | eval bake-off |
| Embeddings/rerank | Voyage, Cohere, OpenAI, BGE | bake-off | Low | dataset needed |
| Observability | OTel + Grafana/Datadog/Honeycomb, Sentry | OTel + Sentry | High | — |

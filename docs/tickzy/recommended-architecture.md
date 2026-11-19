# Tickzy — Recommended Architecture (proposal, pending spikes)

- **Date:** 2026-11-19 · Basis: `docs/research/architecture-research/saas-architecture.md`, `docs/research/technology-comparisons/technology-options.md`, `docs/research/ai-research/ai-architecture.md`, `docs/research/integration-research/communication-channels.md`, `docs/research/technical-research/data-model.md`.
- **Decision status:** ⚠️ *Proposed, not decided.* Items marked **SPIKE** require a time-boxed prototype before commitment (see roadmap Phase 0). No application code exists yet by design.

## 1. Shape
```
          ┌──────────── Edge / CDN (widget, help center, static) ─────────────┐
 Browser  │  Agent app (SPA)   Help center & portal (SSR)   Widget (tiny)     │
          └───────┬───────────────────────┬──────────────────────┬────────────┘
                  │ REST/OpenAPI + WS      │                      │
          ┌───────▼────────────────────────▼──────────────────────▼────────────┐
          │ TypeScript modular monolith — one codebase, several process roles  │
          │  api · realtime · ingest(webhooks: Slack/Teams/email/CRM) · worker │
          │  ai-runner · scheduler(SLA ticker)                                 │
          │  modules: identity, workspace, channels/*, conversations, issues,  │
          │  accounts, sla, routing, automation, ai, knowledge, analytics,     │
          │  integrations/*, billing, public-api, audit                        │
          └──┬──────────────┬──────────────┬──────────────┬───────────────────┘
             │              │              │              │
        PostgreSQL      Redis/Valkey    Object storage   LLM gateway → providers
   (RLS, outbox, queue,  (rate limits,   (attachments,    (Anthropic/OpenAI/…,
    pgvector, FTS)        presence, WS    raw events)      embeddings, rerank)
                          pub/sub)
```
Per region (US, EU) one **cell**; a global tenant directory routes workspaces to their cell.

## 2. Key choices & rationale
| Area | Proposal | Why (evidence) | Reversibility |
|---|---|---|---|
| Monolith | modular monolith, process roles | Intercom/Zendesk/Chatwoot; small team velocity | high (extract later) |
| Language | TypeScript end-to-end | shared types, AI/MCP SDK ecosystem, hiring | medium |
| DB | Postgres, shared schema + `workspace_id` + RLS; UUIDv7/prefixed IDs | proven path to shards/cells (Zendesk, Intercom) | medium |
| Events | transactional outbox + append-only issue timeline | consistency for SLA, webhooks, audit, analytics | high |
| Jobs | Postgres-backed queue + durable workflow library behind interface; SLA via indexed `due_at` + ticker | one datastore early; Plain SLA semantics | high (**SPIKE**) |
| API | REST + OpenAPI 3.1, date versioning, cursor pagination, idempotency keys; UI uses public API | Plain parity; Pylon/Intercom conventions | low (public contract) |
| Webhooks | typed event catalogue = automation event catalogue; HMAC+timestamp, retries ≥24 h, replay UI | Plain at-least-once; Pylon weakness | medium |
| Realtime | WS gateway with invalidation/patch events via Redis pub/sub; **SPIKE Zero** for inbox | Productlane lesson | medium |
| Frontend | agent app SPA (Vite + TanStack Router/Query), help center/portal Next.js, widget separate tiny bundle; Tiptap editor; Radix/React Aria + Tailwind | interactivity vs SEO split | medium (**SPIKE**) |
| Search | Postgres FTS (+pg_trgm), pgvector HNSW hybrid; external engine only on evidence | simplicity | high |
| AI | LLM gateway (routing, fallback, caching, metering, redaction, tracing); staged pipeline; agents as principals; risk-classed tools; shadow/backtest; tenant-isolated retrieval with provenance | Fin, Plain, Pylon patterns; Slack ToS | high |
| Channels | adapter interface (normalize/segment/deliver/sync/limits); Slack via Events API; Marketplace approval early | Slack 2025 rate-limit/ToS changes | medium |
| Auth | own user/session model + WorkOS (SSO/SCIM) | enterprise features without paywall | medium |
| Infra | AWS (ECS/EKS, RDS Postgres, ElastiCache, S3, KMS), Terraform, static egress IPs, CloudFront | Pylon/Intercom precedent; compliance | medium |
| Observability | OpenTelemetry (incl. GenAI spans) + Sentry; SLOs on ingestion & SLA accuracy | — | high |
| Security | SOC 2 from day one practices, audit log, envelope-encrypted integration secrets, SSRF guard, separate user-content domain | competitor baseline | — |

## 3. Non-negotiable invariants
1. Every tenant row has `workspace_id`; every query tenant-scoped; RLS enforced in tests.
2. Inbound events persisted before ack; idempotent processing; nothing lost.
3. The UI uses only public (or soon-public) API endpoints.
4. Every state change emits a domain event; timeline is append-only.
5. AI never acts outside its principal's permissions; risky actions need approval; all AI actions logged with sources and cost.
6. Slack-sourced data is provenance-tagged, never used for model training or cross-tenant benefit.

## 4. Spikes before committing (Phase 0)
S1 Slack ingestion & segmentation prototype (Events API, modes, AI matching) · S2 Inbox UI performance (SPA + WS invalidation vs Zero) · S3 SLA engine semantics & timer scale test · S4 RLS + ORM ergonomics & performance · S5 Retrieval bake-off (embeddings/rerankers/hybrid) on a sample corpus · S6 Email threading/parsing quality on real samples · S7 Legal review of Slack ToS & DPA for AI features.

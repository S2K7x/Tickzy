# AI Architecture Research for Tickzy

- **Research date:** 2026-11-19 · **Missions:** M15 (AI capabilities), M16 (agent architecture), M18 (knowledge management), M27 (AI infrastructure)
- **Primary sources:** competitor AI docs ([Plain handoffs](https://www.plain.com/docs/product/agents/ari/handoffs), [Plain test mode](https://www.plain.com/docs/product/agents/ari/test-mode), [Plain context](https://www.plain.com/docs/product/agents/ari/context), [Plain actions & approvals](https://www.plain.com/docs/product/agents/sidekick/actions-and-approvals), [Plain AI triage](https://www.plain.com/docs/product/platform/ai-triage), [Plain AI and your data](https://www.plain.com/docs/product/security/ai-and-your-data), [Pylon Test/Backtest](https://docs.usepylon.com/pylon-docs/agents/support-agent/test.md), [Pylon Monitor & Iterate](https://docs.usepylon.com/pylon-docs/agents/support-agent/monitor-and-iterate.md), [Pylon Runbooks](https://docs.usepylon.com/pylon-docs/agents/support-agent/build/runbooks.md), [Pylon Skills](https://docs.usepylon.com/pylon-docs/agents/skills.md), [Fin AI Engine](https://fin.ai/ai-engine), [Fin CX Models](https://fin.ai/cx-models), [Thena AI logs](https://docs.thena.ai/guides/ticketing/ai-logs.md), [Thena Flows](https://docs.thena.ai/guides/ai-agents/flows.md)); Anthropic model catalogue (Claude API skill reference, cached 2026-11-03); embedding/reranker market roundups ([reintech](https://reintech.io/blog/embedding-models-comparison-2026-openai-cohere-voyage-bge), [futureagi rerankers](https://futureagi.com/blog/best-rerankers-for-rag-2026/), [beri.net re-embedding cost](https://www.beri.net/article/openai-vs-cohere-vs-qwen3-embedding-models-enterprise-rag-2026)); Postgres search ([pg_search README](https://pgxn.org/dist/pg_search/pg_search/README.html), [pgvectorscale + hybrid](https://thebuild.com/blog/on-pgvectorscale-and-hybrid-search-without-an-elasticsearch-sidecar/), [pgvector iterative scans](https://dev.to/kornilovconstru/hybrid-search-in-postgresql-combining-pgvector-vector-search-with-scalar-filters-using-iterative-46o4)); Slack API ToS ([slack.com/terms-of-service/api](https://slack.com/terms-of-service/api)).
- **Status:** Recommendations are *proposals pending validation by prototypes and evals* — no irreversible decision is made here.

---

## 1. What competitors ship (consolidated) — VERIFIED from docs

| Capability | Pylon | Plain | Fin/Intercom | Zendesk | Thena | ClearFeed |
|---|---|---|---|---|---|---|
| Customer-facing agent | Support Agent (assignable user) | Customer Agent | Fin ($0.99/outcome) | AI agents (per automated resolution) | AI agents (flows) | AI agents |
| Agent-facing copilot | Assist Agent, editor copilot | Sidekick (investigates logs/code/tracker) | Copilot ($29/seat) | Copilot ($50/seat), Admin Copilot | Co-pilot | AI answers |
| Ops/analysis agent | AI reports, Ask AI | Insights/themes | Fin Operator (credits) | Admin Copilot (applies approved changes) | — | Trending queries |
| AI triage (labels/priority) | Taxonomy, AI fields | AI-selected labels & priority | yes | Intelligent triage | AI tagging | AI category/priority/emotion |
| AI status ("whose turn") | **Yes** (On You/On Customer) | auto "waiting for customer" | — | — | — | AI state transitions |
| Message→issue segmentation | AI conversation view | AI ingestion mode | — | — | AI ticket detection | AI detection |
| Procedures/runbooks | Runbooks (AI *or* human-guided) | Skills, workflows step | Procedures (Apex for Procedures) | — | Flows | — |
| Skills (markdown instructions) | Yes, importable | Yes | — | — | — | — |
| Tool calling / actions | built-in + custom API actions + MCP connectors | plugins + approval classes | Data connectors | actions | permissioned tools | Okta/IT actions |
| Human approval gates | via skills/actions | **Run directly vs requires approval** classes; Slack approve/deny | — | Admin Copilot approvals | — | approval workflows |
| Testing | **Backtesting** on past issues (≤3 variants, auto-QA grade) + simulation | **Test mode shadowing on live threads**, playground | Simulations/testing | — | — | — |
| Observability | issue logs, outcome funnel | private timeline entries | traces | — | **AI logs tab + executions** | — |
| Knowledge gaps | missing content | **knowledge gaps API** | Content gaps | — | — | — |
| BYO agent | yes | **Connected agents** (machine users) | Fin into any helpdesk | Forethought agents outside ZD | — | — |
| MCP server | yes | yes | — | — | yes | yes |
| Providers disclosed | ZDR, in-region; not named | **OpenAI + Anthropic** | custom models + third-party under ZDR | — | "native LLMs" | BYO AI (Foqal); — |

**Conclusion:** the AI feature *list* is now commoditised. Differentiation lives in (1) **quality & safety engineering** (grounding, calibrated handoff, no loops), (2) **evaluation tooling** (backtests, shadow mode, regression suites), (3) **context depth** (account, product data, code, logs), (4) **cost transparency**, and (5) **openness** (BYO agent/model/key).

## 2. Design principles for Tickzy AI (derived)

1. **Pipeline of stages, not one prompt** (Fin's 9-model suite): language detect → issue summarise → retrieve → rerank → decide (answer / ask / act / escalate) → generate → validate → deliver. Each stage is independently swappable (frontier LLM today, fine-tuned small model tomorrow) and independently evaluated.
2. **Agents are users.** Like Pylon/Plain, an agent is an assignable principal with a role, scoped permissions, an audit trail and a capacity of ∞. One permission system for humans and agents.
3. **Explicit budgets.** Per-turn context budgets (Plain: 50 msgs × 2,000 chars; AI conditions 600 × 3,000), step limits (6 rounds) and wall-clock limits (45 s), per-tenant monthly spend caps.
4. **Enumerated handoff policy** shipped as editable, versioned config (Plain's list is the starting point: human requested, knowledge miss → gap, needs unavailable action, abuse/churn threat, sales, feature request, outage → Urgent, security incident → High; hard stops: human replied (permanent), bot loop ×3, out of budget, nothing indexed).
5. **Risk-classed actions** (Plain): `read` → auto; `reversible write` → auto + audit; `customer-visible / irreversible` → approval card (web, Slack, Teams).
6. **Shadow before live** (Plain test mode) + **backtest before deploy** (Pylon). Every change to prompts/skills/knowledge creates a new *agent version*; deploys are gated on eval pass rates.
7. **Every AI action is a timeline event** with inputs, retrieved sources, reasoning summary, cost and model (Thena AI logs). Humans can rate it; ratings become eval data.
8. **Honest metrics:** "resolved" = closed while assigned to agent **and** no reopen within N days **and** no negative CSAT; report deflection, false-resolution and escalation-latency separately (Pylon counts customer drop-off as resolved — avoid).
9. **Tenant isolation of AI data** (required by Slack ToS: no LLM training on Slack API data, no cross-org benefit): every content chunk carries `workspace_id` + `source_channel` provenance; no cross-tenant retrieval, caches, or fine-tuning; training pipelines must exclude Slack-sourced data entirely.
10. **Provider abstraction with honest limits:** a thin internal `LLMGateway` (model routing, retries, fallbacks, caching, cost metering, redaction, tracing) — not a heavy framework — because provider-specific features (prompt caching, structured outputs, citations, refusal handling) matter for quality and cost.

## 3. Agent topology (proposed)

```
                ┌───────────────── Event bus (issue.created, message.added, ...) ─────────────────┐
                │                                                                                 │
        Triage Agent (cheap, fast)                    Customer Agent (answers)          Copilot (agent-facing)
  - segment message → issue                 - retrieve KB/past issues/account ctx      - drafts, summaries, "catch-up"
  - language, sentiment, priority,          - decide: answer/ask/act/escalate          - investigate (logs/code/tracker via MCP)
    product area (taxonomy), spam           - cite sources; validate; deliver           - runbooks step-by-step
  - whose-turn status (On us/On customer)   - shadow mode / live mode per queue         - approvals for risky actions
                │                                       │                                       │
                └──────────────► Tool layer (typed tools, risk classes, approvals, MCP connectors, customer's own API actions)
                                                        │
                                   Ops Agent (async, batch): themes, knowledge-gap → draft articles, QA scoring of every
                                   conversation (human & AI), SLA risk prediction, account signals, weekly reports
```
- **Multi-agent is used sparingly:** a router + specialised single agents with tools. Avoid free-form agent-to-agent chatter (cost, unpredictability). Long investigations (copilot) may fan out to sub-agents for parallel reading.
- **BYO agents** connect as machine users via the same API/webhooks/MCP (Plain's connected agents; Fin Custom Helpdesk API compatibility as a stretch goal — see `competitors/intercom.md`).

## 4. Model selection & routing (as of 2026-11; re-check before build)

Anthropic first-party prices (per 1M tokens, input/output) from the Claude API catalogue (cached 2026-11-03): **Haiku 5.5 $0.10/$0.50**, **Sonnet 5.5 $2/$10**, **Opus 5.5 $4/$20**, **Fable 5.2 $8/$40**; all 1M context; prompt caching (cache reads e.g. $0.10 Sonnet 5.5, $0.20 Opus 5.5), Batch API at 50% cost, structured outputs (`output_config.format`), strict tool schemas, citations on document blocks, server-side refusal fallbacks, `inference_geo` for data-residency of inference. VERIFIED (vendor reference).

| Stage | Latency budget | Proposed default | Rationale / alternatives |
|---|---|---|---|
| Spam/auto-reply/lang detect | <100 ms | heuristics + small classifier | no LLM needed for most; Fin uses XLM-R |
| Segmentation, whose-turn, priority, labels, sentiment | <1–2 s | **Haiku-class** model with structured outputs | high volume; later fine-tuned encoder (ModernBERT-style) on *non-Slack* labelled data |
| Summaries, titles, catch-ups | async | Haiku-class; Batch API for backfills | cost |
| Customer-facing answers | 3–15 s | **Sonnet-class** default; escalate hard cases to Opus-class | quality/cost balance; prompt-cache the stable system+tools+policy prefix |
| Copilot investigations, runbooks, tool-heavy | 10–120 s, streamed | Opus-class (effort tuned per route) | multi-step tool use |
| Ops analytics (themes, QA scoring) | hours | Batch API, Sonnet/Haiku | 50% discount |
| Embeddings | — | managed (Voyage 4 family / Cohere Embed 4 / OpenAI 3-large) **or** self-hosted BGE-M3 | evaluate on our own retrieval set; choose a model family with stable/compatible versions to avoid costly re-embeds (re-embedding 10M chunks priced at ~$520 for one provider — [beri.net](https://www.beri.net/article/openai-vs-cohere-vs-qwen3-embedding-models-enterprise-rag-2026)) |
| Reranking | <300 ms | managed reranker (Cohere Rerank / Voyage rerank) or open-weight (BGE v2-m3, Qwen3, mxbai) | rerankers give the largest quality gain per dollar in RAG |
Embedding/reranker versions & prices: **PARTIALLY VERIFIED** (secondary sources disagree on versions; re-verify).

Routing rules: per-route model + effort config; fallback chain on errors/refusals; per-tenant BYO-key option (enterprise trust, and shifts LLM COGS to customer); optional "EU inference only" via region-pinned providers (Pylon does in-region inference — VERIFIED).

## 5. Retrieval (RAG) design

**Sources:** help-center articles, internal KB/runbooks, past resolved issues (curated, PII-redacted), product docs sites (crawler), Notion/Confluence/Google Drive/GitHub (connectors), account data (CRM fields, plan, usage) via **context cards**, live tools (status page, incident tool, product API).

**Index:** chunk by semantic sections (headings) with metadata (workspace_id, source, visibility: public/internal, product area, language, updated_at, ACL). **Visibility is critical:** internal-only content must never reach customer-facing answers (Plain: Sidekick findings "stay internal").

**Search:** hybrid = BM25/full-text + vector (HNSW) + metadata filters → reciprocal rank fusion → reranker → top-k with diversity → generation with citations → **validator** (is every claim supported by a cited chunk? is it customer-safe?).

**Storage options:**
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Postgres + pgvector (HNSW, iterative scans for filtered queries since 0.8) + Postgres FTS or ParadeDB `pg_search` (BM25) | one database, transactional tenant isolation (RLS), simple ops | very large tenants / high QPS need care; pg_search is an extension (managed-host availability varies) | **Start here** |
| Dedicated vector DB (Turbopuffer, Qdrant, Pinecone) | scale, cost at large volume (object-storage-backed), namespaces per tenant | another system, sync pipelines | Phase 3+ if needed |
| OpenSearch/Elasticsearch | mature hybrid search, aggregations | heavy ops | only if search analytics outgrow Postgres |
(pgvector iterative scans version naming inconsistent across sources → PARTIALLY VERIFIED.)

**Knowledge flywheel:** handoffs with "knowledge miss" → knowledge-gap records → clustered → Ops Agent drafts article → human review workflow (Pylon article review) → publish → re-index → backtest affected past issues.

## 6. Context engineering
- Stable prefix (system policy, tone, tools, handoff policy) → cache-friendly; volatile suffix (customer, thread, retrieved chunks).
- Thread compression: last N messages verbatim + rolling summary of older ones; strip quoted email history/signatures (Plain).
- Account context injected as structured JSON (plan, tier, ARR band, open incidents, recent issues), not prose.
- Per-tenant **memories** (Pylon user/account memories) stored as explicit, editable records — never hidden.
- Prompt-injection defence: customer content is data — wrapped, never concatenated into instruction positions; tools with side effects require policy checks outside the model; output validator for exfiltration (URLs, secrets, internal notes).

## 7. Evaluation system (a product feature, not just internal tooling)
- **Datasets:** auto-built from past issues (stratified by product area/channel), "bad AI responses", hand-curated golden sets.
- **Graders:** rubric LLM-judge (Pylon Agent QA style) + deterministic checks (cited? policy violated? leaked internal info? correct handoff?) + human review queue.
- **Modes:** offline backtest (no customer impact), shadow mode on live traffic, canary % rollout, A/B by queue.
- **Metrics:** grounded-answer rate, correct-handoff precision/recall, harmful-answer rate, reopen rate, CSAT delta, cost/issue, p50/p95 latency.
- **Regression gate:** agent version cannot be promoted if critical-fail rate rises.

## 8. Guardrails & permissions
- Agent roles reuse RBAC; tools declare scopes and risk class; approvals routed to the assignee or a team.
- PII redaction before logging; configurable redaction before LLM calls for regulated tenants; ZDR agreements with providers; per-tenant "AI off" switch (Plain offers workspace-wide and per-feature).
- Customer transparency: label AI replies; "talk to a human" always available; disclosure settings per channel.

## 9. Cost model sketch (UNVERIFIED estimate — to validate with prototypes)
Assume a customer-agent answer ≈ 8k input tokens (mostly cached prefix + retrieved chunks) + 400 output tokens on a Sonnet-class model at $2/$10: ≈ $0.016 uncached input + $0.004 output ≈ **~$0.02 per attempt**, plus embeddings/rerank (<$0.002). Even with 3 attempts per resolution and validation calls, **COGS ≈ $0.05–$0.15 per resolution vs market price $0.75–$1.50** (Help Scout $0.75, Fin $0.99, Plain ~$1.00, Zendesk ~$1.50). → Tickzy can undercut materially or include generous AI in seats while keeping >80% gross margin on AI.

## 10. Frameworks
- Prefer **thin, owned orchestration** (typed tool registry + state machine/durable workflow steps) over heavy agent frameworks; use provider SDKs directly. Evaluate the Vercel AI SDK (TypeScript, provider-agnostic streaming/tools) and OpenTelemetry GenAI tracing; consider Langfuse/Braintrust-style tracing & eval tooling vs building in-house (decision deferred; see `technology-comparisons/technology-options.md`).
- Durable execution (see architecture docs) for long-running agent runs, waits for approvals, and retries.

## 11. Unknowns / next research
- Embedding/reranker bake-off on a real support corpus.
- Legal review: Slack ToS vs RAG over Slack-sourced tickets.
- Small-model fine-tuning feasibility on non-Slack (email/chat/portal) data with customer opt-in.
- Voice agents (out of v1 scope).

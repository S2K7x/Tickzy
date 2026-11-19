# Research Status & Checkpoint

- **Checkpoint date:** 2026-11-19 (session 1)
- **Phase:** Research (no application code — by design).
- **Coverage:** 11 named competitors + emerging/OSS landscape; channels, AI, architecture, tech, data model, pricing, reviews, UX (text-based), opportunities; product vision/features/architecture/roadmap drafts. Mission-level status: `docs/research/missions/README.md`.

## How this session researched (for reproducibility)
- Primary sources fetched directly with `curl`: vendor `llms.txt` / `llms-full.txt` (Plain 2.4 MB full docs incl. GraphQL reference; Pylon GitBook docs via `.md` URLs; Thena Mintlify docs), official pricing pages (HTML→text via pandoc), Slack changelog & API ToS, Zendesk & Intercom engineering/architecture pages.
- Hacker News threads read via the Algolia API (`hn.algolia.com/api/v1/items/<id>`).
- Web search for third-party reviews, funding, technology landscape — treated as secondary.
- Blocked/unavailable: Reddit API (HTTP 403), ClearFeed docs (JS-rendered GitBook), Help Scout llms.txt (404), screenshots/videos (not processed).

## Most important findings (top 10)
1. Slack now restricts non-Marketplace commercial apps to **1 req/min** on history APIs, requires Marketplace distribution (≥10 installs to be reviewed), and its API ToS **forbids LLM training on Slack data, bulk export, and cross-org benefit** → shapes roadmap & AI design.
2. **Salesforce is acquiring Fin (Intercom) for ~$3.6B** (announced 2026-06-15, pending) → developer distrust & migration window.
3. Pylon (1,800+ customers, $89–139/seat + credits, gating Teams/portal/RBAC) is the closest competitor; Plain ($45–99, seat caps, API-first) wins the dev-tools ICP.
4. AI resolution pricing has converged at **$0.75–$1.50** (Help Scout $0.75, Fin $0.99, Plain ≈$1.00, Zendesk ≈$1.50) while estimated COGS is ~$0.05–0.15.
5. Fin's architecture is a **pipeline of 9 specialised models** (ModernBERT routers, custom retriever/reranker, Apex generator) — the quality frontier.
6. Plain publishes the most rigorous **AI safety specs** (handoff rules, budgets, test mode, approval classes) and **SLA semantics** — reference designs.
7. Universal complaints: pricing opacity, AI inaccuracy/loops, complexity; B2B-specific: email quality in chat-first tools, search, Jira sync, account-level support.
8. Every incumbent at scale runs a **monolith on sharded SQL** (Zendesk pods/shards, Intercom Rails+Vitess) → modular monolith + tenant-scoped Postgres is the evidence-backed start.
9. Teams shared-channel message notifications appear unsupported for bots/RSC → polling design needed (PARTIALLY VERIFIED).
10. Sync-engine choices are costly to reverse (Productlane Replicache→Zero) → spike before committing.

## Confidence summary
High: competitor features/pricing from primary docs; Slack constraints; incumbent architectures. Medium: tech leanings; AI cost estimates. Low: UX layouts (no visuals), review sentiment counts (secondary), emerging-startup funding.

# Zendesk — Investigation

- **Research date:** 2026-11-19 · **Mission:** M07
- **Primary sources:** [zendesk.com/pricing](https://www.zendesk.com/pricing/), [zendesk.com/llms.txt](https://www.zendesk.com/llms.txt), [Zendesk Support technical architecture](https://support.zendesk.com/hc/en-us/articles/4408832509338-Zendesk-Support-scalability-and-performance-Technical-architecture), [developer.zendesk.com llms.txt](https://developer.zendesk.com/llms.txt), [Relate 2026 newsroom](https://www.zendesk.com/dk/newsroom/articles/relate-2026/).
- **Secondary:** [Futurum on outcome pricing](https://futurumgroup.com/insights/zendesk-bets-on-autonomous-ai-agents-outcome-pricing-to-upend-service-models/), [CMSWire Relate 2026](https://cmswire.com/customer-experience/zendesk-unveils-autonomous-ai-workforce-at-relate-2026), [Zendesk MySQL→S3 tiered storage analysis](https://royondata.substack.com/p/unpacking-zendesk-mysqls3-tiered), [aissist Zendesk AI review](https://aissist.io/insights/zendesk-ai-review).
- **Confidence:** HIGH for pricing and published architecture; MEDIUM for AI pricing (sources conflict).

## 1. Position — VERIFIED
The legacy enterprise default: "200,000+ companies", "20,000+ AI customers". Products: Customer Service Suite, Employee Service Suite (ITSM/ESM), Contact Center. Brand pivot to **"Resolution Platform"** powered by a network of AI agents, trained on ~20 billion ticket interactions (vendor claim). Acquired **Forethought** (announced 2026-03-11, closed 2026-03-26) for self-improving AI agents that also run outside Zendesk. Relate 2026 announced an "autonomous AI workforce".

## 2. Pricing — VERIFIED (annual)
| Plan | $/agent/mo | Key inclusions |
|---|---|---|
| Support Team | 19 | Email-centric ticketing, prebuilt dashboards, macros, triggers/automations |
| Suite Team | 55 | + messaging & live chat, telephony, omnichannel routing, AI agents |
| Suite Professional (most popular) | 115 | + skills-based routing, advanced automation, AI insights, data residency options |
| Suite Enterprise (+ Copilot) | sales | + sandbox, advanced security/governance, Copilot bundled |
| Copilot add-on | 50 | Agent assist (Professional+) ; **Admin Copilot** recommends workflow/knowledge changes and can apply approved changes |
| Workforce Engagement bundle | 50 | QA, WFM |
| Contact Center | 83 | |
- **AI agents billed per "automated resolution"** — "pay only for requests resolved by the AI agent without escalation", independently confirmed by a dedicated AI evaluation model (VERIFIED definition). Rate: ~$1.50–$2.00 reported but **not published** (PARTIALLY VERIFIED); some plans include a per-seat dollar allowance drawn down by resolutions.
- Legacy "AI agents – Essential" being removed 2026-12-10 (PARTIALLY VERIFIED, one source).
- Startups: 6-month free Suite for up to 50 agents.

## 3. Feature baseline (Zendesk is the reference implementation) — VERIFIED (general product knowledge + docs index)
- **Ticket model:** statuses New / Open / Pending / On-hold / Solved / Closed (+ custom ticket statuses mapped to these categories); priority (Low/Normal/High/Urgent); type (question/incident/problem/task) — **problem/incident linking** (many incidents ↔ one problem, solve the problem to solve all incidents); requester, submitter, assignee, group, organization, CCs/followers, tags, custom fields, **ticket forms** (conditional fields), side conversations (email/Slack/child tickets with other teams), ticket merge, light agents.
- **Business rules:** triggers (event-based, on create/update, run in order until no more match), automations (time-based, hourly), macros, views, SLA policies (first reply, next reply, periodic update, requester wait, agent work time, pausable update), skills-based and omnichannel routing with capacity rules, business schedules + holidays.
- Help Center (Guide) with themes, community, content blocks, AI generative search; Explore (analytics) with datasets/custom reports; QA (Klaus acquisition) and WFM (Tymeshift acquisition).
- **Marketplace** of 1,500+ apps; Zendesk Apps Framework (ZAF) iframe apps in ticket sidebar/top bar/nav; Sunshine (custom objects, events, profiles).
- APIs: REST (Support, Help Center, Talk, Chat/Messaging/Sunshine Conversations), incremental export APIs (cursor-based) for warehouse sync, webhooks with signing, OAuth; rate limits by plan (≈200–700 req/min Support API, higher with add-on) — PARTIALLY VERIFIED from prior knowledge.

## 4. Architecture — VERIFIED (Zendesk-published)
- Multiple data centres; customer chooses location (data residency).
- **Pod architecture:** each data centre has one or more **pods**, each a self-sufficient copy of Zendesk Support (app, web, DB, workers). New accounts are assigned to a pod; pods can be moved (affects IP allowlists).
- Each pod has several MySQL **database clusters** (primary + 2 mirrors, automated failover). Clusters hold **shards** (logical DBs); **hundreds of shards** worldwide; each shard hosts many accounts sized by data volume; big customers can get a dedicated shard; shards are rebalanced across clusters/pods.
- Event storage evolved DynamoDB → Kafka-ingested MySQL with periodic dumps to S3 (tiered storage) ([analysis](https://royondata.substack.com/p/unpacking-zendesk-mysqls3-tiered)). Ruby/Rails heritage; Zendesk maintains `racecar` (Kafka consumer framework for Ruby). (PARTIALLY VERIFIED)

**Tickzy implication:** "cell"/pod architecture with tenant→shard mapping is the proven endgame for multi-tenant helpdesks (Zendesk pods, Shopify pods, Intercom customer sharding → Vitess). Tickzy should **design for it from day one cheaply**: every table carries `workspace_id`, every query is tenant-scoped, IDs are globally unique (no cross-tenant joins), and a tenant→cell routing layer exists even if there's one cell. See `docs/research/architecture-research/multi-tenancy.md`.

## 5. Strengths / weaknesses for B2B
- Strengths: completeness, enterprise trust, ecosystem, reporting depth, problem/incident model, side conversations.
- Weaknesses (recurring in reviews — see customer-feedback doc): admin complexity, UI dated/slow, expensive add-on stacking (Copilot $50 + WEM $50 + resolutions), poor Slack Connect story (needs third-party: ClearFeed, Foqal), weak account-centric view for B2B, slow innovation pre-2024.

## 6. Takeaways
1. Use Zendesk's mature primitives as the **completeness checklist** (problem/incident, side conversations, SLA metric set, trigger ordering semantics, incremental export APIs).
2. Don't replicate its admin complexity; Tickzy needs progressive disclosure.
3. Pod/shard architecture = long-term blueprint.

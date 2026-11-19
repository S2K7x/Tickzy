# Tickzy — Definitive Product Strategy (v1.0)

- **Status:** APPROVED baseline for architecture, UX and the build blueprint (2026-11-19). Changes require a dated entry in §13.
- **Inputs:** every document under `docs/research/`, `docs/comparisons/`, `docs/tickzy/` (drafts, now superseded by this file where they conflict).
- **Evidence notation:** `[E: file §section]` points to the research document proving the claim.

---

## 1. Strategic diagnosis

**The market in one paragraph.** B2B support has split into (a) legacy enterprise helpdesks optimised for ticket volume (Zendesk, Freshdesk), (b) chat-first/PLG suites now pivoting to AI agents (Intercom→Fin, being acquired by Salesforce), (c) B2B-native platforms built around Slack Connect and accounts (Pylon, Plain, ClearFeed, Thena), and (d) standalone AI-agent layers (Sierra, Decagon, Forethought→Zendesk). Feature lists have converged; buyers now differentiate on **trust (AI quality, predictable pricing), speed, depth of B2B context and openness**. [E: competitors/emerging-and-open-source.md §1; comparisons/competitor-comparison.md]

**Why now.**
1. Salesforce–Fin deal (announced 2026-06-15) creates distrust and migration intent among developer-led companies. [E: competitors/intercom.md §1]
2. Slack's 2025 platform rules (Marketplace-only commercial distribution, 1 req/min history limits for unlisted apps, no LLM training on Slack data) raise the bar for new Slack tools — a moat once crossed. [E: integration-research/communication-channels.md §1.1]
3. AI resolution is priced at $0.75–$1.50 while estimated cost is ~$0.05–0.15 → room for an honest, cheaper model. [E: pricing-research/pricing-analysis.md §2–3; ai-research/ai-architecture.md §9]
4. Leaders gate basics (Teams, SLAs, SSO, portal) behind $99–139 seats with minimums. [E: competitors/pylon.md §2; competitors/plain.md §2]

## 2. Vision, mission, positioning

- **Vision:** every B2B customer gets a fast, accurate answer in the channel they already use, and every support team knows exactly what needs doing next.
- **Mission:** give B2B support teams one fast workspace where humans and trustworthy AI resolve customer issues across Slack, email and chat, with full account context and a closed loop to engineering.
- **Positioning statement:** *For B2B SaaS support and success teams who support customers in Slack Connect and email, Tickzy is the support platform that combines Pylon-grade B2B depth with an API-first developer platform and AI you can test before you trust — without paywalling the basics. Unlike Zendesk and Intercom it is account-centric and Slack-native; unlike Pylon and Plain it is affordable from seat one, treats email as first-class, and makes every automation and AI change testable on your own history.*
- **Category:** B2B support platform (not "AI agent", not "helpdesk"). Tagline candidate: **"Support that knows your customers."**

## 3. Target audience

| Segment | Definition | Why they buy | Priority |
|---|---|---|---|
| **Primary ICP** | B2B SaaS / dev-tools, Seed–Series C, 3–30 support+success seats, ≥20 customers in Slack Connect, engineering-heavy escalations | Losing requests in shared channels; Zendesk/Intercom too generic or expensive; Pylon/Plain too expensive or gated | P0 |
| Secondary | Series C+ B2B companies, 30–150 seats, mixed email + Slack + Teams | SLA rigor, SSO/SCIM, Teams, migration from Zendesk | P1 (after GA) |
| Tertiary | Internal support (IT/HR/ops) in Slack-native companies | Same engine, different templates | Later [E: competitors/foqal.md; emerging §2] |
| Not targeted | B2C high-volume, e-commerce, contact centres/voice | Different economics and channels [E: competitors/gorgias.md] | — |

**Personas:** Support Lead (buyer; cares about SLA, visibility, cost), Support Engineer (daily user; cares about speed, context, escalation), CSM/Account owner (collaborator; cares about account health), Engineer on escalation (occasional collaborator; must never need a paid seat), Admin/Ops (configures routing, AI, integrations), Customer end-user (in Slack/email/portal).

## 4. What the evidence says

### 4.1 Strongest features across competitors (adopt, best-in-class version)
| Feature | Best implementation | Evidence |
|---|---|---|
| Slack ingestion modes (time / AI / 1:1 / emoji) | Plain | [competitors/plain.md §4] |
| AI "whose turn" status + AI conversation matching | Pylon | [competitors/pylon.md §3–4] |
| SLA semantics (multi-schedule, deadline moves with hours, follow-up SLA) | Plain + Pylon | [plain §5; pylon §5] |
| Routing: skills, capacity per channel, pull queues, SLA-sorted queue | Pylon | [pylon §6] |
| Internal threads mirrored to Slack | Pylon / ClearFeed | [pylon §3; clearfeed §3] |
| Context cards (declarative UI from customer's API) | Plain | [plain §8] |
| Agent handoff policy, budgets, bot-loop guard, human-ownership lock | Plain | [plain §7] |
| Test mode (shadow) + backtests with QA grading | Plain + Pylon | [plain §7; pylon §9] |
| Risk-classed AI actions with approvals (also in Slack) | Plain | [plain §7] |
| AI action log per ticket | Thena | [competitors/thena.md §4] |
| Multi-stage AI pipeline (detect→summarise→retrieve→rerank→generate→validate) | Fin | [competitors/intercom.md §4] |
| Collision detection, shared drafts, inline comments | Front | [competitors/front.md §3] |
| Problem/incident linking; tracker tickets; close-the-loop | Zendesk / Intercom / Plain | [zendesk §3; intercom §3; plain §3] |
| Typed, signed, at-least-once webhooks | Plain | [plain §8] |
| AI taxonomy (product areas from history, human-curated) | Pylon | [pylon §4] |
| Free tier & simplicity | Help Scout / Thena | [help-scout §2; thena §2] |

### 4.2 Features worth combining (Tickzy's "workflows", not separate features)
1. **Problems** = Zendesk problem/incident + Intercom tracker + Pylon issue groups/anomaly detection + Plain close-the-loop → one object that groups issues, links the engineering ticket, broadcasts updates to affected channels, and auto-notifies on fix. [E: market-opportunities/opportunities.md §10]
2. **Escalation-to-engineering loop** = AI repro summary + similar issues + Linear/Jira create/link + auto Blocked status + follow-up SLA + close-the-loop.
3. **Knowledge flywheel** = handoff "knowledge miss" → gap record → AI draft → review → publish → backtest affected issues. [E: ai-architecture.md §5]
4. **Configuration safety** = routing simulator + SLA preview + workflow dry-run on history + AI backtest — one "Test on past issues" pattern across all config.
5. **Account signals** = sentiment trend + champion left channel + volume spike + renewal date → one "needs attention" list. [E: pylon §10]

### 4.3 Redundant functionality to avoid
- Separate "triggers", "automations", "macros", "AI automations" products (Pylon has four overlapping concepts) → Tickzy has **Workflows** (event/schedule/manual triggered, deterministic + AI steps) and **Snippets** (text only). [E: pylon §7]
- "Conversation vs ticket" double objects with double-firing triggers → one **Issue** with a `kind` lifecycle (conversation → issue) and one event stream. [E: pylon §7 footguns]
- SLA policy + separate trigger to apply it → a policy carries its own applicability conditions. [E: ux-research §3]
- Separate AI "credits" for every feature → AI included with fair use, metered only for customer-facing resolutions and heavy investigations.
- Full CS suite (notebooks, opportunities, call recordings) — out of scope; integrate rather than rebuild. [E: tickzy/product-opportunities.md]

### 4.4 Common customer frustrations → Tickzy answer
| Frustration | Evidence | Tickzy answer |
|---|---|---|
| Unpredictable, stacked pricing | Trustpilot 1.8 Zendesk, 2.9 Fin; Pylon ~$100k median | One price page, no gated basics, hard AI spend caps, live cost meter |
| AI inaccurate, loops, can't reach human | Fin G2 "Inaccuracy" 74, HN threads | Conservative agent, citations required, one-tap human, bot-loop guard, shadow first |
| Admin complexity | Zendesk reviews; Pylon footguns | Opinionated defaults, templates, AI setup assistant, simulators |
| Email weak in chat-first tools | Pylon G2 | Email built to Front/Zendesk standard from MVP |
| Search can't find past threads | Plain G2 | Fast hybrid search with operators as an MVP requirement |
| No company-level view in generic tools | HN Fogbender | Account-centric data model from day one |
| Lock-in, can't bring own AI | eesel review, HN | BYO agent via API, BYO LLM key, full export |
| Jira sync one-way | HN Libredesk | Bidirectional Linear/Jira in MVP |
[E: customer-feedback/review-analysis.md §2]

### 4.5 Competitive weaknesses to exploit
- **Pylon:** price & minimum seats; Teams/RBAC/portal at $139; SSO add-on; string-typed webhooks, 30–300 rpm API; config footguns. [pylon §2, §8, §7]
- **Plain:** seat caps (≤5, ≤10), Teams/SLAs at $99; fewer channels; search; no CS signals. [plain §2, §11]
- **Intercom/Fin:** B2C heritage, outcome-fee anxiety, Salesforce uncertainty. [intercom §1, §6]
- **Zendesk:** complexity, cost stacking, weak Slack Connect. [zendesk §5]
- **ClearFeed/Thena/Unthread:** less polish, smaller platforms. [clearfeed §5]

## 5. Differentiation (the five bets)
1. **No paywalls on the basics** — Slack, Teams, email, SLAs, SSO (SAML), API, webhooks, portal on every paid plan; unlimited free collaborators.
2. **AI you can test before you trust** — shadow mode, backtests, risk-classed actions, per-issue AI log, honest metrics, spend caps, BYO key.
3. **Email and Slack both first-class**, with best-in-class segmentation and threading.
4. **Programmable by default** — public REST API is the UI's API; typed signed webhooks; MCP server; context cards; BYO agents.
5. **Fast** — keyboard-first, sub-100 ms interactions, mobile triage.

Non-goals: being the cheapest helpdesk; voice; B2C; full CS platform; on-prem (until enterprise demand).

## 6. Core modules
| # | Module | Purpose | MVP? |
|---|---|---|---|
| 1 | **Workspace & Identity** | tenants, users, roles, SSO, API tokens, audit log | ✅ (SSO at GA) |
| 2 | **Channels** | Slack, email, chat widget (MVP); Teams, Discord, portal (later) | ✅ partial |
| 3 | **Inbox & Issues** | conversations→issues, statuses, priority, fields, labels, assignment, notes, merge/split, search, views | ✅ |
| 4 | **Accounts & Contacts** | identity graph, tiers, owner, account view, signals (later) | ✅ basic |
| 5 | **SLA & Routing** | policies, business hours, timers, teams, round-robin; skills/capacity later | ✅ core |
| 6 | **Workflows** | event-driven automation with conditions/actions/waits, versioned, dry-run | GA |
| 7 | **AI** | triage, whose-turn, summaries, drafts with citations, similar issues (MVP); customer agent, backtests (GA); copilot investigations (v2) | ✅ copilot |
| 8 | **Knowledge** | sources (docs crawler, internal notes), help center, gaps | ✅ basic |
| 9 | **Engineering loop & Problems** | Linear/Jira links, problems, close-the-loop | ✅ links; Problems GA |
| 10 | **Analytics** | volume, FRT, resolution, SLA compliance, AI outcomes | ✅ core |
| 11 | **Developer platform** | REST/OpenAPI, webhooks, MCP, context cards, SDK | ✅ API+webhooks; rest GA |
| 12 | **Billing & metering** | plans, seats, AI usage caps | GA |

## 7. MVP scope (design-partner release) — final
**In:** modules 1–5, 7 (copilot features), 8 (basic), 9 (Linear+Jira links), 10 (core), 11 (API + webhooks); desktop + responsive mobile triage; light/dark themes; US region (EU before GA).
**Out of MVP (explicit):** customer-facing AI agent live replies (shadow-only in MVP), Teams, Discord, portal, workflows builder (fixed built-in automations only: auto-assign, auto-close resolved after N days, SLA alerts), billing, SSO, importers.
**MVP success criteria:** 5 design partners running daily support for 2 weeks; zero lost inbound messages; Slack→inbox p95 < 5 s; agents rate speed ≥ 8/10; ≥30% of replies use AI drafts.

## 8. Roadmap after MVP
- **GA (public launch):** customer AI agent live (per-queue), backtests, knowledge gaps, workflows v1 with dry-run, problems, portal, SAML SSO, HubSpot/Salesforce, importers (Zendesk, Intercom, Pylon, Plain), free tier, billing, EU region, Slack Marketplace listing, SOC 2 Type I.
- **v2:** Teams, Discord, SCIM, custom roles, skills & capacity routing, signals, investigative copilot via MCP connectors, warehouse sync, AI QA of all conversations, BYO LLM key, Fin custom-helpdesk compatibility.
- **Later:** internal-support edition, WhatsApp/SMS, dedicated cells, HIPAA.

## 9. Pricing strategy (to validate in discovery)
- Free: 3 seats, Slack + email + widget, AI copilot fair-use, 50 AI resolutions/mo.
- Team: **$39/seat/mo** annual — everything in §5 bet 1; 500 AI resolutions/mo pooled.
- Business: **$79/seat/mo** — SCIM, custom roles, advanced routing, warehouse sync, EU residency choice, priority support.
- Enterprise: custom — dedicated cell, HIPAA, contracts.
- AI resolutions beyond allowance **$0.49** each; strict definition (closed while assigned to AI, not reopened in 7 days, no negative CSAT); hard caps. BYO key: no AI fees.
- Collaborators (view, internal notes, reply from internal Slack threads) free and unlimited.
Rationale: undercuts Pylon ($89–139) and Plain ($45–99) while staying above SMB tools; AI price below Help Scout's $0.75 with ~5× gross margin. [E: pricing-analysis.md]

## 10. Go-to-market & long-term competitive strategy
1. **Wedge:** dev-tools/B2B SaaS teams drowning in Slack Connect; acquisition via free tier + Slack Marketplace + migration offers for Intercom/Fin customers during the Salesforce transition.
2. **Expand:** seats grow from support to success; collaborators convert to seats; AI usage grows.
3. **Moat over time:** (a) Slack Marketplace approval + deep Slack/Teams engineering; (b) per-tenant eval data and knowledge flywheel (tenant-isolated, no cross-tenant training — also a trust message); (c) developer ecosystem (API, MCP, context cards, Channel SDK); (d) migration tooling.
4. **Defend against Pylon/Plain:** price & openness; against Zendesk/Salesforce: speed & B2B depth; against AI-agent startups: be the best *host* for their agents (connected agents) rather than fight them.

## 11. Key product principles
Speed over chrome · Explain every automatic decision · Defaults that work on day one · Humans own customer relationships (AI never traps) · Every config is testable · Open by default · Accessibility WCAG 2.2 AA.

## 12. Metrics framework
North star: **issues resolved within SLA per agent-hour**. Inputs: FRT p50/p90, SLA compliance, AI-assisted reply rate, AI resolution rate (strict), false-resolution rate (<2%), reopen rate, time-to-first-value (<30 min), weekly active agents, collaborator→seat conversion.

## 13. Decision log
| Date | Decision | Evidence |
|---|---|---|
| 2026-11-19 | ICP = B2B SaaS/dev-tools with Slack Connect | review-analysis §2D, competitor-comparison |
| 2026-11-19 | MVP excludes live AI agent (shadow only) | ai-architecture §2.6, review-analysis §2B |
| 2026-11-19 | No paywall on Teams/SLA/SSO/API | pylon §2, plain §2 |
| 2026-11-19 | One Issue object + Workflows instead of triggers/macros/automations | pylon §7, plain §6 |
| 2026-11-19 | Email first-class in MVP | review-analysis §2F |

# Master Roadmap — zero to production SaaS (draft)

- **Date:** 2026-11-19 · Durations assume a small founding team (3–6 engineers); adjust after Phase 0. Feature contents per phase: `docs/tickzy/proposed-features.md`.

| Phase | Goal | Key outputs | Exit criteria |
|---|---|---|---|
| **R — Research (current)** | Understand market & technology | this docs repository | research gaps in `docs/progress/next-research-tasks.md` closed or consciously accepted |
| **D — Discovery (2–4 wks)** | Validate ICP & priorities | 10–15 interviews, 5–10 design-partner commitments, pricing tests, Slack/Teams usage data | ≥5 partners committed to install; top-10 pain list ranked |
| **0 — Spikes & foundations (4–6 wks)** | De-risk architecture (spikes S1–S7) | ADRs, repo skeleton, CI/CD, IaC, auth, tenancy+RLS, outbox, job system, OpenAPI pipeline, observability | ADRs accepted; ingestion prototype hits p95 <5 s; legal sign-off on Slack ToS approach |
| **1 — MVP (10–14 wks)** | Design-partner release | Slack + email + widget, issues/SLA/assignment, accounts, Linear/Jira, copilot AI, analytics v1, API/webhooks | partners run daily support in Tickzy for 2 weeks; zero message loss; NPS from agents |
| **1.5 — Slack Marketplace** | Unlock rate limits & distribution | ≥10 active installs, security review, listing | approved listing |
| **2 — GA (10–14 wks)** | Public launch | customer AI agent (shadow→live), backtests, knowledge gaps, context cards, MCP, workflows v1 w/ dry-run, portal, SSO, CRM sync, importers, free tier, billing & metering | SOC 2 Type I; uptime 99.9% over 30 days; AI false-resolution <2% on eval |
| **3 — Scale & enterprise (ongoing)** | Teams, Discord, SCIM, custom roles, signals, investigative copilot, warehouse sync, SOC 2 Type II, ISO 27001 | | enterprise deals closed; Teams parity |
| **4 — Expansion** | Internal-support edition, cells/single-tenant, HIPAA, more channels | | |

## Critical path & risks
1. **Slack Marketplace chicken-and-egg** (10 installs needed while throttled at 1 req/min for history) → recruit design partners early, live ingestion via Events API, lazy backfill.
2. **Slack ToS & AI** → legal review in Phase 0.
3. **Teams shared-channel notifications** → hybrid polling design, schedule in Phase 3.
4. **AI quality** → eval harness built in Phase 0/1 before any customer-facing agent.
5. **Pylon/Plain velocity** → focus on differentiators (no paywalls, testability, trustworthy AI, email+Slack quality).

# Tickzy — Product Vision (draft for discussion)

- **Date:** 2026-11-19 · Status: hypothesis built from research; to be validated with 10–15 design-partner interviews (B2B SaaS / dev-tools, 3–50 support seats, heavy Slack Connect use).

## One-liner
**Tickzy is the B2B support platform where humans and AI agents resolve customer issues together — in Slack, Teams and email — with the speed of Linear, the depth of Pylon and the openness of an API-first platform.**

## Target customer (initial ICP)
- B2B SaaS & developer-tools companies, Seed → Series C, 3–50 support/success seats, many customers on Slack Connect shared channels plus email and in-app chat; engineering-heavy escalations; currently on Zendesk/Intercom (outgrown or overpaying) or on spreadsheets + Slack, or evaluating Pylon/Plain.
- Buyer: Head of Support / CX / Support Ops; champion: support engineer or founder; influencer: engineering (API/webhooks/MCP).

## Problems we solve
1. Customer requests get lost across dozens of shared channels and inboxes (no SLA, no ownership).
2. Context is scattered (CRM, billing, product data, Linear/Jira, past conversations).
3. Escalation to engineering is manual and customers aren't told when fixes ship.
4. AI tools are expensive, opaque and risky (hallucinations, loops).
5. Helpdesks are slow, complex and paywall the basics.

## Product pillars
1. **Every channel, one queue** — Slack Connect, Teams, email, widget, portal, Discord; smart segmentation; reply where the customer is, as a human.
2. **Account-centric** — issues, health signals and context per customer org; tiers drive SLA/routing.
3. **AI you can trust** — grounded, cited, conservative, tested before launch, explainable after; cheap and capped; bring your own agent or key.
4. **Engineering loop** — Problems linked to Linear/Jira/GitHub; close-the-loop automatically.
5. **Programmable** — the UI runs on the public API; typed webhooks; MCP; context cards; automations testable on history.
6. **Fast** — keyboard-first, instant UI.

## What Tickzy is *not* (v1)
A contact centre, a B2C high-volume tool, a CS suite, an ITSM, or an in-product messaging/tours tool.

## Success metrics (product)
- Time-to-first-value: connected Slack + email and first SLA-tracked issue in <30 min.
- Agent productivity: issues resolved per agent-hour vs baseline; FRT p50/p90.
- AI: grounded-answer rate, false-resolution rate <2%, correct-handoff precision >95%.
- Reliability: Slack→inbox ingestion p95 <5 s; zero lost messages.
- Business: design-partner → paid conversion; NRR; collaborator-to-seat expansion.

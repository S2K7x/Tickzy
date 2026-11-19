# ClearFeed — Investigation

- **Research date:** 2026-11-19 · **Mission:** M03
- **Primary sources:** [clearfeed.ai/llms.txt](https://clearfeed.ai/llms.txt), [pricing](https://clearfeed.ai/pricing), [helpdesk pricing](https://clearfeed.ai/pricing/helpdesk). Secondary: [unthread review](https://unthread.io/blog/clearfeed-review/), [eesel pricing teardown](https://www.eesel.ai/blog/clearfeed-pricing), [Capterra](https://www.capterra.com/p/10012429/ClearFeed/).
- **Confidence:** HIGH for pricing & feature list (vendor llms.txt); LOW for internals (docs site is a JS-rendered GitBook not fetched in this pass).

## 1. Company — VERIFIED (vendor)
Founded 2021 (Delaware); founders ex-Meta, Qubole, Amazon, Udaan; **$2.7M** raised (Peak XV, 8VC); "300+ customers"; G2 4.6★ / 160+ reviews. Target: early-stage tech companies, large B2B tech offering premium Slack/Teams support, internal IT/HR/Ops in Slack-native companies (50–10,000 employees).

## 2. Product editions — VERIFIED
| Edition | What it is |
|---|---|
| External Helpdesk | Customer support across Slack Connect, Teams, email, web chat, portal, Discord, Telegram; native tickets **or** bi-directional sync to Zendesk/Freshdesk/Intercom/HubSpot/Salesforce Service Cloud/ClickUp/Linear |
| Internal Helpdesk | Slack-native service desk for IT/HR/Finance/Legal; forms, approvals, SLAs, employee portal; link to Jira/ClickUp/Asana/Linear/GitHub tasks |
| Integrations Edition | Thin bridge: internal Slack → external ticketing; **no SLAs or metrics** (external system is the record); **not available for Slack Connect** |

## 3. Distinctive features — VERIFIED
- **Triage channel in Slack:** agents reply to hundreds of customer Slack/Teams channels, email and web chat **from one internal Slack triage channel** — the agent never has to leave Slack. (The "Slack *is* the agent UI" philosophy; Pylon/Plain treat Slack as a channel + notification surface instead.)
- **Collections** = groups of Slack channels; SLA policies and business hours are defined **per collection**.
- AI: auto-resolve from **20+ knowledge sources** (Confluence, Notion, Google Docs, websites, GitHub, Guru, Coda, Zendesk/Intercom/Salesforce KBs), actions in Okta/JumpCloud/AssetPanda, **AI state transitions**, auto priority, **customer emotion**, satisfaction, feature category; "Trending Queries".
- Automations on ticket updates combined with AI categorisation; **approval workflows**.
- Forms in Slack that can create tickets *in ClearFeed or directly in Zendesk/ClickUp/Linear*.
- **Announcements:** scheduled broadcasts with attachments to groups of customer channels; replies/reactions tracked centrally.
- Round-robin, rotations, **observers** on tickets.
- API for ticket creation, webhooks, **Events API** for custom reporting; remote **MCP server** + Claude connector.
- Compliance: SOC 2 Type 2 (since Aug 2022), GDPR, HIPAA, SSO on Enterprise, US & EU residency.

## 4. Pricing — VERIFIED (vendor llms.txt, 2026)
| Model | Starter | Professional | Enterprise |
|---|---|---|---|
| Agent-based | $24/agent/mo (AI via add-on) | $49/agent/mo (AI-Pack incl.) | Custom (>15 agents) |
| Usage-based | $40/mo for 10 Slack channels + 100 tickets | $80/mo for 10 channels (Slack/Teams/Discord/Telegram) + 100 tickets | Custom (>100 channels) |
| Integration Edition | from $49/mo for 250 tickets synced | | |

**AI Pack:** $20/100 credits (<500/mo), $15/100 (500–1000), $10/100 (>1000); included at 50 credits/agent on Pro. 14-day trial. Discounts for startups ≤Series B & <3 yrs old, NGOs, education.
**Note:** ClearFeed's own comparison page cites "Omnichannel plans from $65/agent/month" — inconsistent with llms.txt → treat $24/$49 as current, $65 as **PARTIALLY VERIFIED/possibly OUTDATED** ([clearfeed.ai/comparisons/front](https://clearfeed.ai/comparisons/front)).

**Insight:** ClearFeed is the only vendor offering **usage-based (channel × ticket) pricing with unlimited agents** — matching the reality that in B2B many people (engineers, CSMs, AEs) occasionally answer in Slack. Tickzy should seriously consider a "collaborator-friendly" model (free/cheap light seats).

## 5. Weaknesses (PARTIALLY VERIFIED — third-party, competitor-authored reviews; treat with caution)
- UI less polished than Pylon/Plain; reporting shallower; heavy reliance on Slack as UI can be limiting for email-heavy teams ([unthread review](https://unthread.io/blog/clearfeed-review/) — written by a competitor).

## 6. Tickzy takeaways
1. "Reply from Slack triage channel" is a beloved workflow for small teams — Tickzy should support an **agent-in-Slack mode** (full reply/assign/close from an internal Slack channel) in addition to the web app.
2. Channel "collections" for SLA scoping are a simple mental model.
3. The integration-bridge market (keep Zendesk, add Slack) exists; Tickzy can capture it later via a "sync mode", but it's not a wedge.

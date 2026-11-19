# Pricing & Business Model Analysis

- **Research date:** 2026-11-19 · **Mission:** M22
- **Sources:** official pricing pages/llms.txt fetched 2026-11-19: [Pylon facts](https://www.usepylon.com/pylon-facts), [Plain llms.txt](https://www.plain.com/llms.txt), [ClearFeed llms.txt](https://clearfeed.ai/llms.txt), [Thena pricing](https://www.thena.ai/pricing), [Foqal llms.txt](https://foqal.io/llms.txt), [Intercom pricing](https://www.intercom.com/pricing), [Zendesk pricing](https://www.zendesk.com/pricing/), [Front pricing](https://front.com/pricing), [Freshdesk pricing](https://www.freshworks.com/freshdesk/pricing/), [Help Scout pricing](https://www.helpscout.com/pricing/), [Gorgias pricing](https://www.gorgias.com/pricing). All VERIFIED unless noted; annual billing.

## 1. Seat prices ($/seat/month)
| Vendor | Entry | Mid | Top | Notes |
|---|---|---|---|---|
| Pylon | — | 89 (Professional) | 139 (Advanced) / custom | min seats; no free plan; Teams/portal/RBAC at 139 |
| Plain | 45 (≤5 seats) | 99 (3–10 seats) | custom | unlimited viewers |
| ClearFeed | 24 | 49 | custom | or usage-based $40/$80 per 10 channels+100 tickets |
| Thena | 0 (free) / 29 | 79 | 119 | AI included |
| Foqal | $100 flat ≤5 | 50 (min 3) | 75 (min 10) | requesters free |
| Intercom | 29 | 85 | 132 | + Fin per outcome, Copilot $29 |
| Zendesk | 19 (Support) / 55 (Suite Team) | 115 | Enterprise | Copilot $50, WEM $50 |
| Front | 25 (≤10) | 65 (≤50) | 105 | AI add-ons $10–25 |
| Freshdesk | 19 | 55 | 89 | Copilot $29; day passes $2–12 |
| Help Scout | 0 (5 users) / 25 | 45 | 75 | |
| Gorgias | per ticket volume ($10–$900/mo) | | | never per agent |

## 2. AI pricing
| Vendor | Customer-facing agent | Copilot | Other |
|---|---|---|---|
| Help Scout | **$0.75/resolution** | — | |
| Gorgias | $0.85–1.00/automated interaction | | |
| Intercom Fin | **$0.99/outcome** ($1.99 voice) | $29/seat | Pro $100/mo + $0.01/credit |
| Plain | 100 credits ≈ **$1.00/resolution** | in plan | Sidekick 15–300+ credits/task; BYO agent 15+15 credits |
| Zendesk | ~$1.50–2.00/automated resolution (unpublished — PARTIALLY VERIFIED) | $50/seat | |
| Front | Autopilot from **$0.39/conversation** | $20/seat | Smart QA $20, CSAT $10 |
| Freshdesk | $49/100 sessions (~$0.49/session) | $29/seat | MCP $15/1,000 actions |
| Pylon | credits (rates unpublished) | credits | committed ≥5,000 credits/yr |
| ClearFeed | $10–20 per 100 credits | incl. | |
| Thena | included in seat | included | |

## 3. Patterns & insights
1. **Market price for an AI resolution: $0.75–$1.50**; estimated COGS ~$0.05–0.15 (see AI doc §9) → large margin; price compression is coming (Front $0.39/conversation, Thena "AI included").
2. **Upsell levers everyone uses:** MS Teams, SLAs, SSO/SCIM, RBAC, customer portal, data warehouse, HIPAA, sandbox, audit logs.
3. **Occasional responders** are handled by: unlimited viewers (Plain), viewer seats (Pylon), day passes (Freshdesk), usage pricing with unlimited agents (ClearFeed, Gorgias), free requesters (all).
4. **Seat caps per tier** (Plain ≤5/≤10, Front ≤10/≤50) force sales conversations early.
5. **Opacity complaints** (see review analysis) are strongest with outcome pricing + minimums.

## 4. Pricing hypotheses for Tickzy (to test with design partners — not decisions)
- **Free tier** (e.g., 3 seats, Slack + email + widget, basic AI with a monthly allowance) → PLG funnel (Help Scout/Thena have free tiers; Pylon/Plain don't).
- **One paid core plan** with *no* paywall on Teams, SLAs, SSO, SCIM, API, webhooks, portal (attack Pylon/Plain gating); Enterprise for residency-dedicated cells, HIPAA, custom contracts, sandbox.
- **Seats:** full agents paid; **unlimited free collaborators** (view, internal notes, answer from Slack internal threads) — the B2B reality.
- **AI:** generous included allowance + transparent per-resolution price **below $0.75** with honest definition, **hard spend caps**, live cost meter; **BYO-LLM-key** option for enterprises (zero AI markup).
- Startup discount & migration credits (Intercom/Salesforce transition is an acquisition window).

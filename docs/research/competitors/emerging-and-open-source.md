# Emerging Competitors, AI-Agent Vendors & Open-Source Alternatives

- **Research date:** 2026-11-19 · **Mission:** M12
- **Sources:** [unthread.io/llms.txt](https://unthread.io/llms.txt); HN threads via Algolia API; funding coverage ([Bloomberg on Decagon](https://www.bloomberg.com/news/articles/2026-01-28/ai-customer-support-startup-decagon-valued-at-4-5-billion), [BuiltIn](https://builtin.com/articles/decagon-raises-250m-series-d-4b-valuation-20260130), [Upstarts on Decagon/Sierra](https://www.upstartsmedia.com/p/decagon-sierra-ai-amazing-race), [newmarketpitch deal list](https://newmarketpitch.com/blogs/news/ai-customer-support-list-deals)); OSS roundups ([wz-it comparison](https://wz-it.com/en/blog/zammad-freescout-osticket-chatwoot-helpdesk-comparison/), [openalternative](https://openalternative.co/compare/chatwoot/vs/zammad), [thefrontkit](https://thefrontkit.com/blogs/open-source-ticketing-system)).
- **Confidence:** MEDIUM — funding numbers from aggregators unless noted; star counts are snapshots.

## 1. Market structure (2026)
Three layers are forming:
1. **Systems of record (helpdesks):** Zendesk, Intercom Helpdesk, Freshdesk, Front, Help Scout, Gorgias, Pylon, Plain, Thena, ClearFeed, Unthread, Foqal.
2. **Standalone AI agent layers** (sit on top of any helpdesk): **Fin** (Intercom; being acquired by Salesforce), **Sierra** (~$15B valuation reported, May 2026 $950M Series D; >$100M ARR in 21 months — PARTIALLY VERIFIED), **Decagon** ($250M Series D at $4.5B, Jan 2026 — VERIFIED via Bloomberg/BuiltIn), Parloa (voice), Forethought (acquired by Zendesk, Mar 2026), Ada, Siena (commerce, ~$11M seed), Parahelp (complex B2B software tickets; $3.2M–$18M reported, conflicting), Duckie, Decimal, Inkeep (docs copilot, YC W23), Kapa.ai (docs answers for dev tools — UNVERIFIED this pass), Lorikeet.
   - Sierra, Parloa, Decagon took ~91% of AI-support funding in H1 2026 (aggregator; PARTIALLY VERIFIED).
3. **Infrastructure/headless:** Plain ("support infrastructure"), helpdesk APIs used by in-house agents (Vercel runs its own agent on Plain; HN commenter replaced helpdesk with a self-built agent on local Gemma 4).

**Implication:** B2B helpdesks are converging on "**system of record + bring any agent**". Pylon and Plain both support BYO agents; Plain lists Fin, Decimal, Duckie, Parahelp, Inkeep as connected agents. Tickzy must be an excellent **host for agents** (its own and third-party), not only ship one.

## 2. Slack/Teams-native challengers
| Product | Notes | Source |
|---|---|---|
| **Unthread** (YC S22) | AI-native helpdesk & ITSM in Slack/Teams; CMDB, asset tracking, change mgmt, CAB approvals; customer portal; shared email inbox. Launch HN (81 pts) skepticism: Slack-only doesn't scale for B2C/multi-agent work | [llms.txt](https://unthread.io/llms.txt), [HN](https://news.ycombinator.com/item?id=33593456) |
| **Fogbender** (YC W22) | B2B support "designed for customer teams", company-level conversations, shared customer rooms | [HN](https://news.ycombinator.com/item?id=30332448) |
| **Atlas** | Support platform with Slack Connect tracking (🎫 emoji on ticketed messages) | [help.atlas.so](https://help.atlas.so/articles/322360-slack-connect) |
| **Halp** (Atlassian) | Slack ticketing → now part of Jira Service Management; emoji-only intake in shared channels | [Halp docs](https://plz.halp.com/article/9rnxj4befj-using-halp-in-shared-channels) |
| Suptask, Mava (Discord/community), Relay Channel Manager | Smaller Slack/Discord tools | roundups |

## 3. Open-source alternatives
| Project | License | Stack | Stars (Oct 2026 snapshot) | Notes |
|---|---|---|---|---|
| **Chatwoot** | MIT core + enterprise dir | Rails + Vue, Postgres, Redis/Sidekiq | ~38k | Omnichannel (web, email, WhatsApp, FB, Telegram, API channel), "Captain" AI; YC W21; Launch HN 396 pts |
| UVdesk | MIT (OSL?) | PHP/Symfony | ~19.6k | Was dormant, active again Oct 2026 |
| **Zammad** | AGPL-3.0 | Rails + Vue, Postgres/Elasticsearch | ~6k | Mature, strong in EU/public sector |
| FreeScout | AGPL-3.0 | PHP/Laravel | ~4.6k | Help Scout clone; module marketplace |
| osTicket | GPL-2.0 | PHP | ~4k | Legacy |
| **Libredesk** | AGPL-3.0 | Go single binary + Vue, Postgres | (Show HN 376 pts, Feb 2025) | "Single binary" loved by HN; Jira sync requested |
| Frappe Helpdesk | AGPL | Python/Frappe | — | |
| Peppermint | — | Node | ~3.2k | **Archived** (avoid) |
| Papercups | MIT | Elixir | — | Inactive (Launch HN 2020) |
Star counts: PARTIALLY VERIFIED (snapshots differ by source).

**Implications for Tickzy:**
- OSS players validate demand for self-host and data control but none is B2B/Slack-Connect-native → gap.
- Chatwoot's architecture (Rails monolith + Postgres + Redis/Sidekiq + ActionCable) proves a **modular monolith on Postgres** scales to large OSS deployments.
- An open-source SDK/widget + open core *could* be a distribution strategy; licensing (AGPL vs source-available) is a later decision.

## 4. Watchlist (not yet investigated → next tasks)
Kustomer, Gladly, Hiver (Gmail-native), Missive, HubSpot Service Hub, Salesforce Service Cloud/Agentforce, Jira Service Management, ServiceNow CSM, Featurebase (feedback+support), Enjo, Assembled (WFM), Klaus/Zendesk QA, MaestroQA, Kapa.ai, Mendable, Glean (internal knowledge), Linear Asks (Linear's intake from Slack — strong threat for internal support).

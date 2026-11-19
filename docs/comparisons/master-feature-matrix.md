# Master Feature Matrix

- **Last updated:** 2026-11-19 · Evidence: each cell traces to the competitor dossiers in `docs/research/competitors/` (primary docs). Legend: ✅ documented/available · 💲 paid add-on or upper tier only · ◐ partial/limited · ❌ not found in docs (absence of evidence, not proof) · ? not researched.
- Columns: **Py**=Pylon, **Pl**=Plain, **CF**=ClearFeed, **Th**=Thena, **Fq**=Foqal, **IC**=Intercom, **ZD**=Zendesk, **Fr**=Front, **FD**=Freshdesk, **HS**=Help Scout, **Go**=Gorgias. Last column = proposed Tickzy stance (v1 / v2 / later / no).

## Channels
| Feature | Py | Pl | CF | Th | Fq | IC | ZD | Fr | FD | HS | Go | Tickzy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Slack Connect shared channels | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐(apps) | ◐ | ◐ | ❌ | ❌ | **v1** |
| Slack internal channels/DMs | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ◐ | ? | ? | ❌ | ❌ | v1 |
| Slack ingestion modes (time/AI/1:1/emoji) | ◐(AI view) | ✅ | ◐ | ◐ | ✅(8 methods) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **v1** |
| Reply as yourself in Slack | ? | ? | ? | ✅ | ? | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | v1 |
| MS Teams | 💲 | 💲 | ✅ | ✅ | ✅ | ? | ✅ | ? | ✅ | ❌ | ❌ | v2 (all plans) |
| Email (shared inbox) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **v1 (first-class)** |
| Personal email sync (CSM inbox) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | v2 |
| Chat widget + identity verification | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | v1 |
| Mobile chat SDKs | ✅ | ? | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ✅ | ✅ | ? | later |
| Discord | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ◐ | ❌ | ❌ | ❌ | ❌ | v2 |
| WhatsApp / SMS / Telegram | ✅ | ❌ | ◐(Telegram) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | later |
| Voice/phone | 💲 | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ✅ | ❌ | 💲 | no (v1–v2) |
| Customer portal | 💲 | ✅(headless) | ✅ | ✅ | ? | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | v1 (basic) |
| Broadcasts to Slack channels | ✅ | ✅ | ✅ | ✅ | ? | ◐(outbound) | ❌ | ❌ | ❌ | ◐ | ❌ | v2 |

## Ticketing & workflow
| Feature | Py | Pl | CF | Th | Fq | IC | ZD | Fr | FD | HS | Go | Tickzy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Conversation→ticket promotion | ✅ | ❌(thread only) | ✅ | ✅ | ✅ | ✅ | ❌ | ◐ | ❌ | ❌ | ❌ | v1 |
| AI whose-turn status | ✅ | ◐ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **v1** |
| Ignored / noise status | ❌ | ✅ | ? | ? | ? | ? | ◐ | ◐ | ◐ | ◐ | ◐ | v1 |
| Close-the-loop on fix | ◐(on-hold auto) | ✅ | ◐ | ❌ | ❌ | ◐(tracker) | ✅(problem) | ❌ | ◐ | ❌ | ❌ | **v1 (Problems)** |
| Merge / split | ✅ | merge | ? | related | ? | ✅ | merge | ✅ | ✅ | ✅ | ✅ | v1 |
| Internal threads synced to Slack | ✅ | ✅(discussions) | ✅ | ✅ | ✅ | ❌ | side conv. | ❌ | ❌ | ❌ | ❌ | v1 |
| Collision detection / shared drafts | ? | ? | ? | ? | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | v1 |
| SLA: first/next/resolution | ✅ | 💲 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | v1 (all plans) |
| SLA: follow-up/periodic update | ✅ | ❌ | ? | ? | ? | ? | ✅ | ? | ? | ❌ | ❌ | v1 |
| Multi-schedule business hours + holidays | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | v1 |
| Skill-based routing | ✅ | ◐ | ❌ | ◐ | ✅ | ✅ | 💲 | ✅ | ✅ | ❌ | ✅ | v2 |
| Capacity limits per channel | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ◐ | ✅ | ❌ | ? | v2 |
| Pull-based queue | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ❌ | ❌ | ❌ | ❌ | v2 |
| Escalation paths | ◐ | 💲 | ? | ? | ✅ | ✅ | ✅ | ? | ✅ | ❌ | ? | v1 |
| Visual workflow builder | ◐(triggers) | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ | ✅ | v1 (simple) → v2 visual |
| Workflow versioning / dry-run | ◐(logs) | ❌ | ? | ? | ? | ? | ❌ | ❌ | ◐(sandbox) | ❌ | ❌ | **v1 differentiator** |
| AI prompt condition in workflows | ✅(automations) | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ? | ? | ? | ? | v1 |
| CSAT / NPS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | v1 CSAT / v2 NPS |

## Accounts / B2B context
| Feature | Py | Pl | CF | Th | Fq | IC | ZD | Fr | FD | HS | Go | Tickzy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Account-centric view | ✅ | ✅ | ◐ | ✅ | ◐ | ◐ | ◐ | ◐ | ◐ | 💲 | ❌ | v1 |
| Tiers drive SLA | ✅ | ✅ | ◐ | ◐ | ✅ | ? | ◐ | ? | ? | ❌ | ❌ | v1 |
| Live context cards from your API | iframe | ✅ | ❌ | ❌ | ◐ | Canvas Kit | ZAF apps | plugins | apps | ◐ | ✅ | **v1** |
| Health scores / signals | 💲 | ❌ | ❌ | ◐ | ✅(CRM) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | v2 (signals) |
| Champion-left alerts | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | v2 |
| Feature request extraction | ✅ | ◐(themes) | ❌ | ❌ | ❌ | ◐ | ❌ | ❌ | ❌ | ◐ | ❌ | v2 |
| Call recording ingestion | ✅ | ❌ | ❌ | ◐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | later |

## AI
| Feature | Py | Pl | CF | Th | Fq | IC | ZD | Fr | FD | HS | Go | Tickzy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Customer-facing agent | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | v1 (conservative) |
| Copilot drafts w/ citations | ✅ | ✅ | ✅ | ✅ | ✅ | 💲 | 💲 | 💲 | 💲 | ✅ | ✅ | v1 |
| Investigative copilot (logs/code/tracker) | ✅ | ✅ | ❌ | ❌ | ❌ | ◐ | ◐ | ❌ | ❌ | ❌ | ❌ | v2 |
| Backtesting on past issues | ✅ | ◐(playground) | ❌ | ❌ | ❌ | ✅ | ? | ? | ? | ? | ? | **v1** |
| Shadow/test mode on live | ? | ✅ | ❌ | ❌ | ❌ | ◐ | ? | ? | ? | ? | ? | **v1** |
| Action approval classes | ◐ | ✅ | ✅(approvals) | ◐ | ✅ | ? | ✅(admin) | ? | ? | ? | ? | v1 |
| Per-ticket AI log | ✅(issue logs) | ✅ | ? | ✅ | ? | ✅ | ? | ? | ? | ? | ? | v1 |
| Knowledge gaps → drafts | ✅ | ✅ | ? | ? | ? | ✅ | ✅ | ? | ? | ? | ? | v1 |
| AI taxonomy / themes | ✅ | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ | ◐ | ✅ | ◐ | ✅ | v1 |
| AI QA of all conversations | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | 💲 | 💲 | ◐ | ❌ | ❌ | v2 |
| BYO agent (connected agents) | ✅ | ✅ | ❌ | ❌ | ❌ | n/a | ◐ | ❌ | ❌ | ❌ | ❌ | **v1 (API-level)** |
| BYO LLM key | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | v2 |
| MCP server | ✅ | ✅ | ✅ | ✅ | ? | ? | ? | ? | ✅(metered) | ? | ? | v1 |

## Platform & admin
| Feature | Py | Pl | CF | Th | Fq | IC | ZD | Fr | FD | HS | Go | Tickzy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Public API parity with UI | ◐ | ✅ | ◐ | ◐ | ? | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | **v1** |
| Typed event webhooks w/ signing | ◐(templated strings) | ✅(+mTLS) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | v1 |
| SSO SAML | 💲 | 💲 | 💲 | ? | ✅ | 💲 | 💲 | 💲 | 💲 | 💲 | 💲 | **v1 paid plans** |
| SCIM | 💲 | 💲 | ? | ? | ✅ | ? | 💲 | 💲 | 💲 | ? | ? | v2 paid plans |
| Custom roles / RBAC | 💲 | ? | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | v1 basic / v2 custom |
| Audit logs | 💲 | ? | ? | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ? | v1 |
| EU data residency | ✅ | ✅(UK/US) | ✅ | ? | ? | ✅ | ✅ | ✅ | ✅ | ? | ? | v1 (US+EU) |
| Data warehouse sync | 💲 | ◐(Polytomic) | ◐ | ❌ | ❌ | ◐ | ◐ | ? | ? | ❌ | ❌ | v2 |
| Free plan | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ◐ | ✅ | ◐ | **v1** |

# Integration Ecosystem Research (CRM, issue tracking, incident, knowledge, data, developer platform)

- **Research date:** 2026-11-19 · **Mission:** M20
- **Sources:** [Pylon facts/integrations](https://www.usepylon.com/pylon-facts), [Pylon docs index](https://docs.usepylon.com/llms.txt), [Plain llms.txt](https://www.plain.com/llms.txt) + [docs index](https://www.plain.com/docs/llms.txt), [ClearFeed llms.txt](https://clearfeed.ai/llms.txt), [Foqal llms.txt](https://foqal.io/llms.txt), [Thena docs](https://docs.thena.ai/llms.txt), [Fin custom helpdesk API](https://developers.intercom.com/docs/guides/fin-custom-helpdesk/authentication.md), HN Libredesk thread (Jira sync request) [link](https://news.ycombinator.com/item?id=43158166).

## 1. Coverage by category (VERIFIED from vendor lists)
| Category | Pylon | Plain | ClearFeed | Thena | Foqal |
|---|---|---|---|---|---|
| CRM | Salesforce, HubSpot, Attio, Pipedrive | Salesforce, HubSpot, Attio | HubSpot, Salesforce | HubSpot, Salesforce | Salesforce, HubSpot |
| Issue tracking | Jira, Linear, GitHub, Asana, Shortcut | Linear, Jira, Shortcut, GitHub | Jira, Linear, ClickUp, Asana, GitHub | Jira, Linear | Jira, ServiceNow |
| Incident/alerting | PagerDuty, Opsgenie, Rootly, incident.io | incident.io, Rootly | — | — | PagerDuty |
| Call recording | Gong, Granola, Fathom, Fireflies, Grain, Circleback, Attention, Meet | — | — | (activity) | — |
| Knowledge sources | KB + resources + connectors | docs, knowledge sources | 20+ (Confluence, Notion, GDrive, GitHub, Guru, Coda…) | files/URLs | Notion, Confluence, Guru |
| Data warehouse | Snowflake, BigQuery, Redshift, S3 | Polytomic | Events API | CSV export | — |
| Codebase/agents | Cursor, Devin | Sidekick plugins, connected agents (Fin, Decimal, Duckie, Parahelp, Inkeep) | — | — | Claude, OpenAI |
| Helpdesk migration/sync | — | importers from Zendesk, Intercom, Help Scout, Freshdesk, Front, HubSpot SH, JSM, Pylon, SF Service Cloud | sync to Zendesk/Freshdesk/Intercom/HubSpot/SF | — | Zendesk sync |
| Dev platform | REST, SDKs (TS/Py/Go), CLI, webhooks, MCP, custom apps, iframes | GraphQL+REST, TS SDK, webhooks SDK, MCP, OAuth, UI components, customer cards | API, webhooks, Events API, MCP | API keys, webhooks, MCP | webhooks, secrets manager |

## 2. Design lessons
1. **Engineering-ticket sync is the #1 B2B integration** (Libredesk HN top request; every B2B vendor). Must be bidirectional: create from issue (AI-written repro), link existing, status sync → auto On-Hold / close-the-loop, comments mirrored internally, many issues ↔ one ticket (Problem).
2. **CRM sync** sets account tier/ARR/owner → drives routing & SLA; bi-directional activity push (issues on SF/HubSpot account). Channel auto-creation from CRM (Pylon Salesforce widget).
3. **Incident tools**: link issues to incidents, broadcast updates to affected accounts, anomaly detection (Pylon) → spike alerts.
4. **Context without integrations**: Plain-style **context cards** (POST to customer endpoint, return declarative components) cover the long tail (billing, product admin, feature flags) without Tickzy building each integration.
5. **Actions on customer systems**: typed custom API actions + MCP connectors for AI agents (Pylon/Plain/Foqal) with secrets vault and approvals.
6. **Warehouse sync** for analytics-mature customers (Pylon Advanced) — use CDC/outbox → Parquet on S3 → Snowflake/BigQuery loaders.
7. **Migration importers** (Plain lists 10) are a sales weapon; prioritise Zendesk, Intercom, Pylon, Plain, Front, Help Scout, Freshdesk, JSM.
8. **Automation platforms**: Zapier/Make/n8n apps from the public API + webhooks (cheap reach).
9. **Fin Custom Helpdesk API compatibility** lets customers keep Fin during migration.

## 3. Integration build framework (proposal)
- Provider-agnostic **Connector SDK** internally: OAuth flows & token refresh (encrypted), webhooks in, rate-limit budgets, sync cursors, field mapping UI, health dashboard, per-connector audit.
- Priority order (by B2B value/effort): Slack → Email → Linear → Jira → GitHub → HubSpot → Salesforce → MS Teams → widget/portal → Notion/Confluence/GDrive knowledge → PagerDuty/incident.io → Discord → Zapier → warehouse.

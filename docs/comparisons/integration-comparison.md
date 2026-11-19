# Integration Comparison

- **Last updated:** 2026-11-19 · Full table and lessons: `docs/research/integration-research/ecosystem.md`; channels: `docs/research/integration-research/communication-channels.md`.

| Category | Breadth leader | Notable pattern | Tickzy priority |
|---|---|---|---|
| Chat channels | Pylon (Slack, Teams, Google Chat, Discord, WhatsApp, Telegram, SMS, phone) | Slack ingestion modes (Plain); reply-as-self (Thena) | Slack v1, Teams v2, Discord v2 |
| Email | Front / Zendesk | collision detection, shared drafts | v1 first-class |
| Issue trackers | Pylon/ClearFeed (5–6 trackers) | auto On-Hold + close-the-loop | Linear, Jira, GitHub v1 |
| CRM | Pylon (SF, HubSpot, Attio, Pipedrive) | tier/owner → routing/SLA; channel auto-creation | HubSpot, Salesforce v1–v2 |
| Incident | Pylon (PagerDuty, Opsgenie, Rootly, incident.io) | issue groups / anomaly detection | v2 |
| Knowledge | ClearFeed (20+ sources) | gap detection → drafts | Notion, Confluence, GDrive, docs crawler v1–v2 |
| Call recordings | Pylon (8 tools) | account memories | later |
| Data warehouse | Pylon (Snowflake, BigQuery, Redshift, S3) | sync jobs | v2 |
| Developer platform | Plain (GraphQL parity, webhooks SDK, mTLS, UI components, customer cards, MCP, OAuth) | declarative context cards | v1 (REST/OpenAPI, typed webhooks, MCP, context cards) |
| Migration importers | Plain (10 sources) | migrate in days | Zendesk, Intercom, Pylon, Plain, Front, Help Scout v1–v2 |
| API rate limits | Plain ("no restrictive limits") vs Gorgias 2 rps, Pylon 30–300 rpm, Front sells +100 rpm for $200 | — | generous published limits |

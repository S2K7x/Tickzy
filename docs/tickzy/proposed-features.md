# Tickzy — Proposed Feature Set (by release)

- **Date:** 2026-11-19 · Source of truth for competitor parity: `docs/comparisons/master-feature-matrix.md`. Each feature notes its inspiration. "MVP" = design-partner release; "GA" = public launch; "v2" = after GA.

## MVP (design partners)
**Channels:** Slack (Events API ingestion, shared + internal channels, 4 ingestion modes, AI match to open issues, reply as bot or as yourself, internal triage-channel threads, emoji actions) [Plain, Pylon, Thena]; Email (forwarding inbound, DKIM outbound, threading, quoted-text stripping, inline images, auto-reply/bounce detection) [Plain, Front]; basic chat widget w/ identity verification [Pylon].
**Work model:** conversations → issues; status categories incl. Waiting on customer, Blocked, Resolved, Ignored [Plain/Pylon]; priority; labels; custom fields (issue/account/contact); assignment (manual, round-robin per team); internal notes & mentions; merge/split; collision detection [Front]; command palette + shortcuts [Plain].
**Accounts:** accounts/contacts with identity graph, tiers, owner; auto-mapping from Slack channel / email domain.
**SLA:** first/next/resolution/follow-up; business hours + holidays; pause by category; Slack/email breach alerts [Pylon/Plain spec].
**Engineering loop:** Linear + Jira link/create with status sync → Blocked/close-the-loop [Pylon/Plain].
**AI (copilot-first):** thread summaries & titles, AI triage (labels/priority/product area w/ descriptions), whose-turn status, draft replies with citations from KB + past issues, similar issues [Plain/Pylon].
**Knowledge:** import docs site/help center (crawler), internal notes as knowledge, basic public help center.
**Platform:** REST API (OpenAPI) used by our own UI, API tokens, typed signed webhooks, audit log v1, US + EU regions, Google/Microsoft login.
**Analytics:** volume, FRT/NRT/resolution, SLA compliance, by account/tier/channel/agent.

## GA
Customer-facing AI agent (shadow mode → live per queue; enumerated handoff policy; risk-classed actions; budgets; AI log) [Plain]; backtesting & QA rubric grading [Pylon]; knowledge gaps → article drafts with review [Plain/Pylon]; context cards protocol [Plain]; MCP server; BYO connected agents via API [Plain/Pylon]; Problems (incident grouping + broadcast to affected channels) [Zendesk/Intercom/Pylon]; workflow builder v1 (events, conditions incl. AI condition, actions, waits) with versioning & dry-run [differentiator]; skill-based routing; escalation paths; CSAT; customer portal (account visibility rules); SAML SSO on all paid plans; HubSpot + Salesforce sync; GitHub Issues; migration importers (Zendesk, Intercom, Pylon, Plain); free tier; usage metering & AI spend caps.

## v2
Microsoft Teams (all plans); Discord; personal email sync; capacity & pull-based queues; SCIM; custom roles; broadcasts; account signals (champion left, sentiment, spikes) & health; investigative copilot with MCP connectors (logs/code/tracker) + runbooks/skills; feature-request extraction; warehouse sync; incident tools (PagerDuty/incident.io); AI QA of all conversations; BYO LLM key; translation; mobile-responsive triage + Slack approvals; Zapier/Make/n8n apps; Fin Custom Helpdesk API compatibility.

## Later / maybe
WhatsApp/SMS/Telegram, voice, call-recording ingestion, CS notebooks/opportunities, custom objects, internal (IT/HR) edition, single-tenant cells, HIPAA, self-hosted/open-core components.

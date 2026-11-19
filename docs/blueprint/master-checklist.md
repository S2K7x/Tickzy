# Master Checklist — strategy → requirements → tasks traceability

Every strategy commitment must map to at least one requirement and task. ⬜ not started · 🟡 in progress · ✅ done (verified by tests).

| Strategy item (`product-strategy.md`) | Requirements | Tasks | Status |
|---|---|---|---|
| Module 1 Workspace & identity | FR-1.1–1.7 | T-002–T-008, T-101–T-106 | 🟡 |
| Tenant isolation (ADR-005) | FR-1.5, SEC-3 | T-003, T-004, T-201 | 🟡 |
| Module 2 Channels: Slack (modes, reply as user, internal threads) | FR-2.1–2.5 | T-301, T-304–T-307, T-310 | ⬜ |
| Module 2 Channels: email first-class | FR-2.7 | T-302, T-303 | ⬜ |
| Module 2 Channels: widget | FR-2.8 | T-308 | ⬜ |
| Module 3 Inbox: one Issue object, status categories, whose-turn, ignored | FR-3.1, 3.2 | T-202, T-206 | ⬜ |
| Module 3 Search that works | FR-3.8 | T-207 | ⬜ |
| Module 3 Speed, keyboard, realtime, collision | FR-3.9, 3.11, NFR-1 | T-208, T-209 | ⬜ |
| Module 4 Accounts-centric model | FR-4.1–4.3 | T-201, T-203, T-210 | ⬜ |
| Module 5 SLA (all metrics on all plans) | FR-5.1–5.4 | T-401–T-403 | ⬜ |
| Module 5 Routing basic | FR-3.4 | T-404 | ⬜ |
| Module 6 Built-in automations (MVP) | FR-6 MVP | T-404 | ⬜ |
| Module 7 AI copilot (triage, summary, drafts w/ citations, similar, AI log, caps) | FR-7.1–7.6 | T-501–T-507 | ⬜ |
| Module 7 Shadow-mode agent | FR-7.7 | T-508 | ⬜ |
| Module 8 Knowledge sources & hybrid retrieval | FR-8.1–8.2 | T-504, T-505 | ⬜ |
| Module 9 Linear/Jira bidirectional | FR-9.1 | T-601, T-602 | ⬜ |
| Module 10 Analytics with definitions | FR-10.1 | T-405, T-406 | ⬜ |
| Module 11 API = product API, OpenAPI | FR-11.1 | T-005, T-012, all API tasks | 🟡 |
| Module 11 Typed signed webhooks | FR-11.2 | T-603 | ⬜ |
| Responsive mobile + light/dark | NFR-5, NFR-6 | T-010, T-209, T-406 | ⬜ |
| Slack ToS compliance (provenance, no training) | NFR-4 | T-202 (`source` column), T-310, legal review | ⬜ |
| Security baseline | SEC-1–14 | T-604 + per task | ⬜ |
| Reliability (no lost messages) | NFR-2 | T-301, T-605 | ⬜ |
| Observability | NFR-7 | T-005, T-605 | ⬜ |
| Deploy & backups | — | T-011, T-606 | ⬜ |
| GA items (agent live, backtests, workflows, problems, portal, SSO, CRM, importers, billing, EU, MCP, Marketplace, SOC 2) | FR-6, 7.7–7.9, 8.3, 9.2, 11.3, 12, 1.8 | Phase B epics E20–E34 | ⬜ |
| Pricing (no paywalls, free collaborators, AI cap) | FR-12 | E29 | ⬜ |

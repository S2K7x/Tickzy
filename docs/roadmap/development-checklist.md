# Development Checklist (pre-build gates and phase checklists)

> Live status of implementation tasks is tracked in `CURRENT-STATE.md` and `docs/blueprint/backlog.md` (task IDs). Gates below were completed on 2026-11-19 by the approved strategy, architecture (ADR-001…019) and blueprint.

- **Date:** 2026-11-19 · Nothing here is started; research phase only.

## Before writing application code
- [ ] Design-partner interviews done; ICP confirmed
- [x] ADR-001 system shape (modular monolith) accepted
- [x] ADR-002 language/runtime accepted
- [x] ADR-003 tenancy model (shared schema + RLS + tenant directory) accepted
- [x] ADR-004 (as ADR-003 API style in final numbering) API style & versioning accepted
- [ ] ADR-005 jobs/workflows engine accepted (after S3)
- [ ] ADR-006 realtime approach accepted (after S2)
- [ ] ADR-007 frontend frameworks accepted (after S2)
- [x] ADR-008 cloud (final: ADR-016)/regions accepted
- [x] ADR-009 auth (final: ADR-006)/SSO vendor accepted
- [ ] ADR-010 LLM gateway & provider policy accepted (after S5)
- [ ] Legal review: Slack API ToS, DPA, sub-processors (S7)
- [ ] Security baseline policy (SOC 2 controls mapping)

## Phase 0 foundations
- [x] Monorepo, lint/format/typecheck (T-001) · [ ] CI verified on GitHub (T-011 written) · [ ] preview envs
- [ ] IaC for US + EU cells, secrets/KMS, static egress IPs
- [ ] Auth, workspaces, members, roles, API tokens
- [x] Postgres schema conventions, RLS, migrations, ID scheme (T-002–T-004)
- [ ] Outbox + domain event bus + job system
- [x] OpenAPI generation (T-012) · [ ] SDK generation
- [ ] OpenTelemetry + Sentry + structured logging
- [ ] Eval harness skeleton (datasets, graders, reports)

## Phase 1 MVP
- [ ] Channel adapter interface; Slack adapter (events, modes, outbound, internal threads, emoji actions)
- [ ] Email adapter (inbound, outbound, threading, parsing, hygiene)
- [ ] Widget v1 (identity verification)
- [ ] Conversations/issues/messages/timeline; statuses; fields; labels
- [ ] Accounts/contacts/identity graph; tiers
- [ ] SLA engine + business hours
- [ ] Assignment & teams; notifications
- [ ] Agent app: inbox, views, issue view, command palette, shortcuts, collision detection
- [ ] Linear + Jira integrations
- [ ] AI: summaries, triage, whose-turn, drafts with citations, similar issues
- [ ] Analytics v1; webhooks v1; audit log v1
- [ ] Load/chaos tests on ingestion; data export

## Phase 2 GA (selected)
- [ ] Customer agent (shadow/live, handoff policy, approvals, budgets, AI log)
- [ ] Backtesting + QA rubrics; knowledge gaps flow
- [ ] Context cards; MCP server; connected agents
- [ ] Workflows v1 with versioning/dry-run
- [ ] Portal; help center v1; SSO; CRM sync; importers
- [ ] Billing, metering, spend caps, free tier
- [ ] SOC 2 Type I

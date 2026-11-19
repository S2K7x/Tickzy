# Data Model Research & Proposed Domain Model (draft)

- **Research date:** 2026-11-19 · **Mission:** M24
- **Evidence:** public APIs — Pylon REST (issues, accounts, contacts, messages, custom objects, activities, highlights, feature requests, tasks, ticket forms, external IDs; [API conventions](https://docs.usepylon.com/pylon-docs/developer/api/conventions.md)); Plain GraphQL (customers, accounts/companies, tenants, tiers, threads, thread fields, labels/label types, events, snippets, tasks, knowledge gaps, machine users; [docs](https://www.plain.com/docs/llms.txt)); Intercom (contacts, companies, conversations + conversation parts, tickets & ticket types, data attributes/events; [dev docs](https://developers.intercom.com/llms.txt)); Zendesk (tickets, users, organizations, groups, side conversations, problem/incident — PARTIALLY VERIFIED from product knowledge).
- **Status:** a *research draft* to guide architecture; not a schema to implement yet.

## 1. Observed modelling choices
| Concept | Pylon | Plain | Intercom | Zendesk |
|---|---|---|---|---|
| Person | Contact (external id) | Customer (external id) | Contact (user/lead) | User (end-user) |
| Org | Account (+ subaccounts, partner accounts) | Account (+ tenants, tiers, customer groups) | Company | Organization |
| Work unit | Issue (+ ticket flag), issue number | Thread (`T-123`) | Conversation (+ tickets) | Ticket |
| Messages | Messages (source channel, internal/external) | Timeline entries (chat, email, slack, note, custom event) | Conversation parts | Comments (public/private) |
| Custom data | custom fields (issue/account/contact) + **custom objects** | thread fields, account fields | data attributes | ticket/user/org fields + custom objects |
| Product events | custom activities on accounts | customer/thread **events** w/ UI components | data events | Sunshine events |
| Identity for API | scoped API tokens | machine users w/ fine-grained keys, OAuth | apps/OAuth | API tokens/OAuth |

## 2. Proposed core entities (Tickzy)
```
Workspace (tenant) ─ Region/Cell
 ├─ Member (user ↔ workspace, role, teams, skills, capacity, status, working hours)
 ├─ Agent (AI or connected machine principal; versioned config) ← same principal table as Member
 ├─ Team / Queue (routing strategy, assignment limits, SLA scopes)
 ├─ Account (customer org) ── parent/sub-accounts, partner links, tier, owner(CSM), external_ids, fields, health/signals
 │    └─ Contact (person) ── identities[] (email, slack:{team,user}, teams:{tenant,aad}, discord, phone), visibility role within account
 ├─ Channel (connection: slack workspace, teams tenant, mailbox, widget, discord guild, api) ── ChannelEndpoint (specific Slack channel / address) → default account, ingestion mode, SLA collection
 ├─ Conversation (raw thread in a channel endpoint; external refs) 1─* Message
 ├─ Issue (unit of work) ── status(category+custom), priority, assignee(principal), team, account, requester, fields, labels, product_area, sla_targets[], links[]
 │    ├─ IssueConversation (an issue can span conversations; one conversation can be split into issues)
 │    ├─ Message (external/internal, author principal|contact, body AST, attachments, channel delivery states, edits)
 │    ├─ InternalThread (linked to Slack/Teams thread or native)
 │    ├─ Task, Follower, CSAT response
 │    └─ IssueEvent (append-only timeline: status change, assignment, SLA, AI action w/ trace, automation run…)
 ├─ Problem (root cause; links many Issues; linked EngineeringTicket(s); close-the-loop broadcast)
 ├─ EngineeringTicketLink (Jira/Linear/GitHub/… with synced status)
 ├─ SLAPolicy → SLATarget (per issue, metric, due_at, consumed_ms, state)
 ├─ BusinessSchedule (+ overrides)
 ├─ Workflow (versioned definition) → WorkflowRun → StepRun
 ├─ KnowledgeSource → Document → Chunk (embedding, visibility, provenance)
 ├─ Article (help center; versions, reviews, translations)
 ├─ KnowledgeGap
 ├─ Broadcast → BroadcastDelivery
 ├─ ContextCardDefinition (endpoint, keys, TTL)
 ├─ WebhookEndpoint → WebhookDelivery ; ApiToken / OAuthApp
 ├─ AuditLogEntry
 └─ UsageMeter (AI credits, messages, seats) 
```

## 3. Key modelling decisions to make (with research-backed defaults)
1. **Issue vs Conversation separation** (default: separate; enables Plain-style ingestion modes, Pylon-style AI matching, merge/split without data loss).
2. **Principal abstraction** for humans, AI agents, connected agents, integrations, automations (all actions attributable; RBAC uniform).
3. **Message body as portable AST** (blocks: paragraph, mention, code, image, file, quote, button) + original raw payload kept for fidelity/audit.
4. **Identity graph**: contacts have many channel identities; account inference rules (email domain, Slack team, shared channel mapping, CRM sync) with manual override + audit.
5. **Customer-side visibility** (portal): contact roles within an account (admin/member/billing) and issue visibility (private/account-wide) — HN-raised need.
6. **Provenance tags** on every content item (`source: slack|email|…`) to enforce Slack ToS restrictions on AI training/export.
7. **IDs:** prefixed time-ordered IDs (`iss_`, `msg_`, `acc_`), per-workspace human numbers.
8. **Soft delete + retention policies + redaction** as first-class (Pylon redaction; GDPR erasure).
9. **Custom objects** (Pylon/Zendesk) — defer, but keep fields engine generic (JSONB + typed definitions + indexes on hot fields).

## 4. Open questions
- How much CS/account intelligence (health scores, notebooks, opportunities) belongs in v1? (Recommendation in product docs: signals + health basics only.)
- Multi-workspace per company (Plain Frontier "multiple workspaces") — support via org → workspaces hierarchy.

# Pylon — Complete Investigation

- **Research date:** 2026-11-19
- **Mission:** M01 (see `docs/research/missions/README.md`)
- **Primary sources:** official docs (GitBook, `docs.usepylon.com`), official `llms.txt`, official "Pylon Facts" page, pricing page. Third-party sources used only for review sentiment and contract-value data.
- **Overall confidence:** HIGH for features/pricing (vendor primary docs, dated Nov 2026); MEDIUM for architecture (only what Pylon publishes); LOW for internal implementation (hypotheses marked).

---

## 1. Summary

Pylon (Pylon Labs, Inc.) is the category-defining "B2B-native" support platform. It started as a Slack Connect ticketing tool and has expanded into an omnichannel help desk + customer-success (account intelligence) + "agentic" AI platform. In July 2026 it relaunched as an "agentic support platform". It now claims 1,800+ B2B customers (Nov 10 2026 facts page; 1,500+ in its Oct 26 llms.txt — the number moves fast).

Its core thesis: **B2B support happens in shared chat channels (Slack Connect / Teams), is account-centric (not ticket-centric), and needs CS + support + product context in one place.**

| Attribute | Value | Evidence |
|---|---|---|
| Company | Pylon Labs, Inc. | VERIFIED — [Pylon Facts](https://www.usepylon.com/pylon-facts) |
| Customers | "1,800+ B2B companies" (Airtable, Amplitude, Applied Intuition, Cognition, Linear, Together AI, Ashby) | VERIFIED (vendor claim) — Pylon Facts |
| Hosting | AWS us-west-2 (Oregon) and eu-central-1 (Frankfurt); single-region per tenant | VERIFIED — [Security Overview](https://docs.usepylon.com/pylon-docs/security/security-overview.md) |
| Compliance | SOC 2 Type II, ISO 27001:2022, GDPR, HIPAA (Advanced+), BAA (Enterprise) | VERIFIED — Security Overview, Pylon Facts |
| Pricing model | Seats + "agentic credits"; never per ticket/resolution | VERIFIED — Pylon Facts |

---

## 2. Pricing (as of 2026-11-10) — VERIFIED

Source: [Pylon Facts](https://www.usepylon.com/pylon-facts), [Pricing](https://www.usepylon.com/pricing), [llms.txt](https://www.usepylon.com/llms.txt)

| Plan | Price | Notable inclusions |
|---|---|---|
| Professional | $89/seat/mo (annual) | Core support, viewer seats, analytics, automations, Skills, broadcasts, MCP, API, integrations |
| Advanced (recommended) | $139/seat/mo (annual) | + RBAC, customer portal, custom reporting, data-warehouse sync, **Microsoft Teams & Google Chat**, HIPAA, audit logs, message redaction; SAML SSO as $125/mo add-on |
| Enterprise | Custom | + MSA, SAML SSO, SCIM, sandbox, retention controls, BAA, compliance archiving, custom roles, team SLAs, SLA counting settings |

Add-ons: Phone $35/seat/mo; Account Intelligence $10 per **customer account**/mo; SAML on Advanced $125/mo.
Credits: agentic features (Assist Agent, Support Agent, Slack Agent, Automations, AI issue QA, backtesting) consume credits. Committed packages start at 5,000 credits/year; PAYG when enabled.
Constraints: minimum seat count for new customers; **no free plan**; trials via sales.

**Third-party cost data (PARTIALLY VERIFIED):** a pricing analysis reports a median contract of ~$100.8k/yr (range $16k–$153k) and "hidden" implementation/training fees — [eesel.ai](https://www.eesel.ai/blog/pylon-pricing), [unthread.io](https://unthread.io/blog/pylon-pricing/), [featurebase](https://www.featurebase.app/blog/pylon-pricing). Older reviews list a $59 "Starter" tier that no longer appears on the official page → **OUTDATED**.

**Tickzy implication:** Pylon gates Microsoft Teams, RBAC and the customer portal behind the $139 tier, and SSO behind an add-on/Enterprise. "Teams-on-every-plan" and "SSO not taxed" are cheap differentiators.

---

## 3. Channels — VERIFIED

Source: Pylon Facts; [Channel Configuration](https://docs.usepylon.com/pylon-docs/getting-started/channel-configuration.md); [Slack integration](https://docs.usepylon.com/pylon-docs/integrations/chat/slack.md)

- Slack: Slack Connect shared channels, Slack Community workspaces, internal Slack channels and DMs (all plans).
- Email (support address + **personal email sync** so CSM 1:1 email shows up on the account).
- Chat widget + iOS/Android/React Native SDKs, identity verification, JS API, custom domain.
- Discord, WhatsApp, Telegram, SMS (all plans). Microsoft Teams, Google Chat (Advanced+). Phone/voice (add-on: IVR, recording, transcripts, transfers, number porting).
- Ticket forms; **proactive issues** (agent-initiated conversations); broadcasts.

### How Slack channel onboarding works (UX reconstruction, VERIFIED from docs)
1. Admin first sets up **Internal Threads**: a "#customer-alerts" channel (small teams) or one channel per CSM (`#alex-customers`). Every new customer issue posts a card there; threaded replies sync back to Pylon as internal notes.
2. Channels are classified into **Customer**, **Community** (many companies in one channel) or **Internal** channels.
3. Enable via (a) bulk from the Accounts dashboard, (b) `/invite @Pylon` in Slack → modal → pick "Customer Channel" + triage channel, or (c) autolinking by naming convention (and auto-creation from a Salesforce widget). Private channels must be enabled from inside Slack.
4. Extras: "collect data" modals when a ticket opens in Slack, self-serve "support ticket flow", welcome message, bookmarks, auto-adding new employees to customer channels, **"Left company" alerts when a champion leaves the shared channel** (a clever churn signal).

### Conversation vs. ticket model
- Every inbound starts as an **issue**; issues can be "turned into a ticket" (separate trigger event; SLA counting can restart at ticket conversion). This two-tier model acknowledges that much chat traffic is conversational and should not be SLA-tracked until it's real work.
- For "continuous" chats (Teams chats, WhatsApp, Telegram, SMS), **AI "issue conversation view"** matches each new message to the right open issue; one chat can hold several open issues. (VERIFIED — [Statuses](https://docs.usepylon.com/pylon-docs/support-workflows/issues/statuses.md))

**Tickzy implication:** message→issue segmentation in continuous channels is a hard, core problem. Pylon solves it with an LLM classifier. Tickzy needs a first-class "conversation segmentation" service with confidence scores and an easy manual split/merge.

---

## 4. Issue / ticket model — VERIFIED

Sources: [Issues](https://docs.usepylon.com/pylon-docs/support-workflows/issues.md), [Statuses](https://docs.usepylon.com/pylon-docs/support-workflows/issues/statuses.md), [Views](https://docs.usepylon.com/pylon-docs/support-workflows/issues/views.md), [Merge & split](https://docs.usepylon.com/pylon-docs/support-workflows/issues/merge-and-split-issues.md), [Issue Groups](https://docs.usepylon.com/pylon-docs/support-workflows/issues/issue-groups.md)

**Status model (5 fixed categories):** `New` → `On You` ↔ `On Customer` → `On Hold` → `Closed`.
- "On You / On Customer" is set **automatically by AI** on every new message (whose turn it is), even when the agent replies natively in Slack/email. Admin-toggleable. Optional "Close issues with AI" (e.g., customer says "thanks!"), noted to possibly skip required fields.
- Linking an unfinished Jira/Linear ticket auto-moves to On Hold; new public activity moves it out; snooze = On Hold.
- Closed issues reopen on new activity.
- Custom statuses only allowed within On Hold and Closed categories (e.g., "Waiting on Engineering"), archived not deleted, with a cap on active custom statuses.

**Other issue capabilities:** Kanban + list views, saved views with filters/columns, bulk actions, merge & split, **issue groups** (incident grouping), **anomaly detection** (detects outages across customer base), translation (auto-detect + translate in/out), tags, custom fields (issue/account/contact) with required & conditional fields and **field history**, **AI taxonomy** (product areas), macros, command palette ("Command Search"), followers, internal threads (multiple per issue, each in Pylon or Slack), CSAT, user QA rubrics.

**AI Taxonomy (notable design):** "Generate from issue history" clusters past issues into product areas/sub-areas (~15 min). Each new issue gets auto-labelled and may be relabelled early in the conversation. **Humans cannot hand-edit an issue's product area** — you fix the taxonomy (descriptions + "sorting guidance") and Pylon re-sorts. Moving/deleting an area warns about triggers that depend on it. "Find new product areas" suggests additions with preview of which issues would move. (VERIFIED — [Taxonomy](https://docs.usepylon.com/pylon-docs/platform/taxonomy.md))

**Tickzy implication:** Pylon's taxonomy is a strong, reusable pattern (LLM-generated, human-curated, used for reporting + routing). Not allowing per-issue overrides is a defensible but frustrating choice; Tickzy could allow overrides that feed back as labelled training/eval data.

---

## 5. SLAs — VERIFIED

Source: [SLAs and Timers](https://docs.usepylon.com/pylon-docs/support-workflows/slas-and-timers.md), [Active Time](https://docs.usepylon.com/pylon-docs/support-workflows/slas-and-timers/active-time.md)

- 4 SLA metrics: **First Response, Next Response, Follow-up Time** (proactive: team was last to speak and must send another update — uncommon and valuable for B2B), **Resolution Time**.
- SLA *policies* are applied **via triggers** (conditions on priority, customer tier, etc.).
- Support hours vs calendar hours; targets in **business days** (up to 90), with precise semantics (a day counts if the timer ran at any point during that day's support hours).
- **Counting settings** (Enterprise): choose which statuses the timer runs in per metric; option to restart timers when a conversation becomes a ticket; which reply types count (agent/trigger/human).
- **Team SLAs** (Enterprise): measure time a specific team owned the issue, independent of issue SLA.
- **Active time**: tracks actual time worked; no target.
- Changes apply going forward; historical metrics not recalculated.

**Tickzy implication:** SLA engine must be a deterministic, event-sourced timer service with pause/resume by status, business calendars, holidays and timezones. Pylon's spec is a good reference spec. Gating counting settings to Enterprise is an opportunity.

---

## 6. Routing, assignment, capacity — VERIFIED

Sources: [Assignment Rules](https://docs.usepylon.com/pylon-docs/support-workflows/assignment-rules.md), [Capacity](https://docs.usepylon.com/pylon-docs/support-workflows/assignment-rules/capacity.md)

- Individual assignment via trigger actions; team assignment via strategies: **round robin, recurring schedule (time-of-day), skill-based (weighted skill levels, ordered "skill blocks" each narrowing candidates), pull-based** ("Take new issue").
- User status gating (active/away/OOO).
- **Capacity**: per-person limits per channel class (phone / chat widget / async), which statuses count, "only one live channel at a time", **capacity exceptions** (e.g., Urgent bypasses), AI agents always unlimited. Manual assignment does not check capacity.
- **Queueing**: team queue, default FIFO by priority; configurable queue sort (up to 4 fields incl. SLA-due-soonest), time-entered-queue tiebreaker; skill-block queues.
- Lots of documented edge cases (closed issues skip assignment; ordering of actions in triggers matters) — evidence that the routing engine grew organically and has sharp edges.

---

## 7. Automation engine (Triggers, Macros, Automations) — VERIFIED

Sources: [Triggers](https://docs.usepylon.com/pylon-docs/platform/triggers.md), [Conditions](https://docs.usepylon.com/pylon-docs/platform/triggers/conditions.md), [Template variables], [Logs & History], [Macros], [Automations](https://docs.usepylon.com/pylon-docs/agents/automations.md)

- **Trigger = When (kickoff events, one object type, multiple events allowed) → If (conditions, else-if branches, time delays) → Then (actions)**, organized in groups, from templates or scratch.
- Issue kickoffs include: created, turned into ticket, new message (filter by sender/type, skip first), message edited/deleted, status changed (from→to), assigned, team set, account changed, requester changed, tags changed, custom field changed, unsnoozed, **reaction added** (emoji-driven workflows from Slack), internal thread created, product ticket linked / status changed, CSAT completed, email bounced, message redacted, voice call, **Devin PR opened/merged/closed/waiting** (coding-agent events), SLA changed/breached.
- Notable implementation details: trigger fires after streamed Slack-app replies complete; "new issue + turned into ticket" double-fires for new tickets (footgun documented).
- Logs & history for debugging; Liquid-like `{{ issue.x }}` template variables.
- **Automations (AI)**: kickoff event or schedule → AI instructions or Skill → connected tools/context (KB, past issues, account notebooks, codebases/logs, MCP connectors) → enable.

**Tickzy implication:** a unified rules engine where deterministic triggers and AI steps are nodes in the same graph (rather than two products) would simplify. Pylon's footguns (action ordering, double-firing) are classic signs of non-declarative engines; Tickzy should model workflows as versioned, testable definitions with dry-run/simulation.

---

## 8. Webhooks & API — VERIFIED

Sources: [API conventions](https://docs.usepylon.com/pylon-docs/developer/api/conventions.md), [Rate limits](https://docs.usepylon.com/pylon-docs/developer/api/rate-limits.md), [Webhooks](https://docs.usepylon.com/pylon-docs/developer/webhooks.md)

- REST API, JSON, results in `data`, `request_id` on each response, cursor pagination (`has_next_page`, opaque cursor), RFC3339 timestamps; IDs accept issue number or external IDs for accounts/contacts; **unknown fields silently ignored** (a DX footgun).
- `GET /issues` requires a created_at time window (inclusive start/exclusive end).
- Rate limits **per organization per endpoint per minute** — tiers of 30/120/300 rpm; headers `X-Rate-Limit-Limit/Remaining/Reset`, `Retry-After`.
- Official TypeScript, Python, Go SDKs; experimental CLI; MCP server; custom apps; iframe embeds.
- **Outbound webhooks are not event subscriptions** — they are a *trigger action* with a user-authored JSON template. All values arrive as **strings** (lists comma-joined, missing = ""). 20s timeout, 3 attempts total (≈4s, 8s backoff), `X-Pylon-Retry-Number`, signing secret shown once, private IPs blocked, static egress IPs per region.

**Tickzy implication (opportunity):** Typed, versioned, schema'd event webhooks (Stripe/Svix-style: event types, retries over hours/days, replay UI, delivery logs) would be a clear DX advantage over Pylon's stringly-typed trigger webhooks and 30-rpm limits.

---

## 9. AI & agents — VERIFIED (capabilities) / UNVERIFIED (models used)

Sources: [Support Agent](https://docs.usepylon.com/pylon-docs/agents/support-agent.md), [Test](https://docs.usepylon.com/pylon-docs/agents/support-agent/test.md), [Monitor & Iterate](https://docs.usepylon.com/pylon-docs/agents/support-agent/monitor-and-iterate.md), [Quality Assurance], [Runbooks](https://docs.usepylon.com/pylon-docs/agents/support-agent/build/runbooks.md), [Skills](https://docs.usepylon.com/pylon-docs/agents/skills.md), [BYOA](https://docs.usepylon.com/pylon-docs/agents/support-agent/build/bring-your-own-agent.md), Pylon Facts

| Capability | What it is |
|---|---|
| Support Agent | Customer-facing; modelled as **a user that can be assigned issues**. Deflects with content, collects info, gathers internal context, end-to-end resolution. |
| Assist Agent | Agent-facing "personal operator": investigates, uses tools, takes actions, delegates to external agents (Devin, Cursor). |
| Slack Agent | Ask/act from Slack with same permissions and context. |
| Skills | Reusable markdown instructions (can be created by asking Assist Agent to "turn this into a Skill"; importable from other AI tools — i.e., compatible with the "skill markdown" convention). Scoped org/team/user. |
| Runbooks | Natural-language step procedures with actions + scoped variables; executable by AI **or by humans step-by-step with copilot guidance**. |
| Actions | Built-in Pylon actions + custom API-call actions. |
| Connectors | MCP connectors to any MCP server; codebase (Cursor, Devin). |
| User Memories | Remembers individual agent preferences. |
| Testing | Custom chat simulation (pick channel/account/contact); **backtesting** against real past issues, up to 3 variants side by side, optional auto-grading with Agent QA rubric, "issues with bad AI responses" dataset, saved datasets; never messages customers. |
| Feedback → fixes | Tag failure reason ("incorrect information", "too wordy", "wrong action") → Pylon suggests edits to guidance/skills/KB. |
| Analytics | Funnel: Assigned → Assisted (Responded / Ran Runbook / Both / No assist) → Outcome (Resolved / Reassigned / Unassigned / In progress); customer drop-off counts as resolved (a generous definition — be skeptical of vendor "resolution rates"). |
| Copilot | AI in editor (rewrite/draft), account copilot, KB copilot, "Ask AI" across data, AI reports pushed to destinations, AI fields, AI tasks, web research into account fields. |
| Security | Zero-data-retention agreements with AI providers; in-region inference (EU stays in EU). Models/providers not disclosed → UNVERIFIED. |

**Tickzy implication:** Pylon's AI "lifecycle" (build → test/backtest → deploy → monitor → feedback-driven fix suggestions) is now table stakes for 2027. Note the resolution definition — Tickzy should publish honest, auditable metric definitions (e.g., "resolved and not reopened within 7 days, positive or no CSAT").

---

## 10. Account intelligence / CS layer — VERIFIED

Source: docs index ([llms.txt](https://docs.usepylon.com/llms.txt)), [Signals](https://docs.usepylon.com/pylon-docs/account-intelligence/customer-overview/signals.md)

Accounts with views, copilot, **memories**, sidebar, personal email, internal channel linking, **partner accounts** (agencies across many customers), **subaccounts** (roll up), opportunities (CRM), **notebooks** (drag-and-drop block layouts), tasks & projects + templates + "smart projects", **AI tasks**, activities timeline + custom activities (via API), fields + **formulas**, **AI fields**, **web research**, **rollups**, health scores (add-on), **Signals** (AI flags accounts needing attention), Overview boards. Call recordings ingestion (Gong, Granola, Fathom, Fireflies, Grain, Circleback, Attention, Google Meet) and calendars. **Feature requests** auto-extracted from conversations.

**Tickzy implication:** This is Pylon's moat vs. Plain — it's becoming a light CS platform (Gainsight/Vitally-lite). Tickzy must decide whether to compete here (recommended: a strong account model with signals, but not a full CS suite in v1).

---

## 11. Knowledge base, portal, surveys, broadcasts — VERIFIED

- KB: articles & collections, WYSIWYG editor, AI copilot, templates, collaboration, **article review workflow**, **synced blocks** (reusable content), translations, **missing-content detection**, analytics (searches, helpfulness), custom themes (templates/CSS/scripts), custom auth, search, redirects (migration), SEO & AI crawler support.
- Customer portal (Advanced+): view/submit tickets, access control, custom auth (SSO with product dashboard).
- Surveys (NPS/CSAT, custom), broadcasts with engagement analytics.

---

## 12. RBAC — VERIFIED

Source: [Roles & User Management](https://docs.usepylon.com/pylon-docs/platform/roles-and-user-management.md)
Roles: Admin, Member, **Viewer** (read-only but can start internal threads & leave notes — good pattern for engineers/sales), **Integration User** (uses Pylon only via Slack/Linear, can't sign in), Custom roles (Enterprise). Detailed capability matrix (e.g., Members can't delete issues or publish KB articles).

---

## 13. Customer sentiment — PARTIALLY VERIFIED

(See `docs/research/customer-feedback/review-analysis.md` for the cross-vendor synthesis.)
- Praised: Slack-native workflow, account view, fast product velocity, Linear/Jira links.
- Criticised (third-party reviews): price & seat minimums, complexity growth, reporting depth, AI not "closing the loop" into roadmap/changelog ([featurebase](https://www.featurebase.app/blog/pylon-ai.md), [thecxlead](https://thecxlead.com/tools/pylon-review/)).

---

## 14. Architecture hypotheses — UNVERIFIED

- Multi-region single-tenant-per-region assignment on AWS (VERIFIED) implies a shared multi-tenant DB per region with tenant-ID partitioning (HYPOTHESIS).
- Webhook payloads built from templates with string interpolation implies trigger engine evaluates on an internal event stream and renders templates (HYPOTHESIS).
- Per-endpoint per-org fixed-window/token-bucket rate limiting (VERIFIED behaviour; implementation unknown).
- Job postings / engineering blog not yet reviewed → next research task.

---

## 15. Key takeaways for Tickzy

1. Pylon defines the B2B feature baseline: shared-channel sync, internal threads, account-centric data, AI status, AI taxonomy, follow-up SLAs, skill routing, backtesting.
2. Weak points to exploit: price/seat minimums, Teams/SSO/portal gating, stringly-typed webhooks, low API rate limits, organic complexity (footguns), generous AI metrics.
3. Pylon is drifting toward CS-platform breadth; a sharper, faster, cheaper support-first product with first-class developer platform has room (this is also Plain's bet).

## 16. Unknowns
- LLM providers, embedding/vector stack, search engine.
- Data model internals (beyond the API).
- Exact credit consumption per AI action (not published; Plain publishes theirs).

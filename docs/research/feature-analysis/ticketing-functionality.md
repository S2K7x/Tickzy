# Ticketing & Conversation Functionality — Cross-Competitor Analysis

- **Research date:** 2026-11-19 · **Missions:** M13 (ticketing), M14 (communication), M17 (automation engine)
- **Sources:** competitor dossiers in `docs/research/competitors/` (each cites primary docs). Key primary pages: [Pylon statuses](https://docs.usepylon.com/pylon-docs/support-workflows/issues/statuses.md), [Pylon SLAs](https://docs.usepylon.com/pylon-docs/support-workflows/slas-and-timers.md), [Pylon assignment](https://docs.usepylon.com/pylon-docs/support-workflows/assignment-rules.md), [Pylon capacity](https://docs.usepylon.com/pylon-docs/support-workflows/assignment-rules/capacity.md), [Pylon triggers](https://docs.usepylon.com/pylon-docs/platform/triggers.md), [Plain statuses](https://www.plain.com/docs/product/platform/threads/statuses), [Plain SLA time](https://www.plain.com/docs/product/platform/slas/sla-time), [Plain ingestion modes](https://www.plain.com/docs/product/channels/slack-ingestion-modes), [Plain workflows](https://www.plain.com/docs/product/workflows/workflows-triggers), [Thena statuses](https://docs.thena.ai/guides/ticketing/statuses.md).

## 1. Unit of work: conversation vs ticket

| Vendor | Model |
|---|---|
| Zendesk | Ticket (everything); side conversations; incident↔problem |
| Intercom | Conversation; tickets (customer / back-office / tracker) attachable to conversations |
| Pylon | Issue (conversation) that can be **turned into a ticket**; SLA counting can restart at conversion; issue groups for incidents |
| Plain | Thread only; merge into parent; lock |
| Thena | Ticket from messages; draft tickets; related tickets |
| Front | Conversation (email-thread metaphor) + ticket statuses |

**Insight:** B2B chat channels produce lots of non-work chatter. The best model is **Conversation → (optionally) Issue** with explicit promotion (manual, emoji, AI-detected, or rule), and an **Ignored** state (Plain) so noise never pollutes metrics. Plus a **Problem** object linking many issues to one root cause/engineering ticket (Zendesk problem/incident, Intercom tracker, Pylon issue groups) with **close-the-loop** notifications when it's fixed (Plain).

## 2. Status models compared
| Pylon | Plain | Thena | Zendesk |
|---|---|---|---|
| New, On You, On Customer, On Hold, Closed (+ custom in On Hold/Closed); **AI sets whose turn** | Todo{Needs first response, Needs next response, Investigating, Close the loop}, Snoozed{Waiting for customer, Paused}, Done{Done, Ignored} | custom under Open/In progress/On hold/Closed | New/Open/Pending/On-hold/Solved/Closed (+custom) |

**Tickzy proposal:** fixed **categories** that drive SLA/metrics semantics + unlimited custom statuses inside each:
`Triage` (new, unanswered) · `Waiting on us` · `Waiting on customer` · `Blocked (internal/engineering)` · `Resolved` (reopens on reply) · `Closed` (locked) · `Ignored` (silenced). Whose-turn transitions automatic (deterministic rule: who spoke last + AI override for "thanks!"/acknowledgements), always explainable in the timeline.

## 3. Priority, fields, classification
- Priority: Urgent/High/Normal/Low (Plain numeric 0–3). AI-selected priority with explicit rubric, never overriding human-set (Plain).
- Custom fields on issue/account/contact with types (text, number, date, select, multi-select, user, account lookup, boolean), **required & conditional** (Pylon, Zendesk forms), **field history** (Pylon).
- Labels/tags hierarchical with descriptions used by AI (Plain "Apply with AI").
- **AI taxonomy** of product areas generated from history, curated by humans (Pylon) → used for routing & reporting.

## 4. SLA engine — reference spec (union of best semantics)
- Metrics: first response, next response, **follow-up time** (proactive update when we spoke last — Pylon), periodic update, resolution, time-in-status, team SLAs (time a team owned it), active/handle time (no target).
- Policies applied by rules (priority × tier × channel × account) — Plain tiers, Pylon triggers.
- Business hours: multiple schedules per target (any-open semantics), timezones, holidays/overrides, business-day targets; running deadlines move when hours change; consumed time never changes; finished targets final (Plain).
- Pause rules by status category; restart on conversation→ticket conversion (optional).
- States: active, warning (pre-breach, once), breached, achieved, canceled. Notifications to Slack/email/in-app; queue sorting by "next SLA due".
- Historical metrics not recalculated on policy change (Pylon) — store computed results.
- **Gap to exploit:** Pylon gates counting settings/team SLAs to Enterprise; Plain gates SLAs to $99 tier → Tickzy: full SLA engine on all paid tiers.

## 5. Routing & assignment
Union of capabilities: rule-based routing to teams/groups with default fallback (Thena); strategies: round-robin, load-balanced, recurring schedule, **skill-based with weighted levels** (Pylon), **pull-based "take next"** (Pylon); queues with configurable multi-key sort incl. SLA due; **capacity per channel class** with exceptions (Pylon); user status (active/away/OOO) & working hours (Plain); account-owner routing (CSM owns their accounts — Plain template "route enterprise threads to account owners"); escalation paths with levels (Plain).
**Tickzy improvement:** a routing **simulator** ("who would get this issue and why") and explainable assignment entries in the timeline — reduces the footguns Pylon documents.

## 6. Collaboration
Internal notes; **internal threads** mirrored to Slack (Pylon/ClearFeed/Thena); side conversations with other teams/vendors via email (Zendesk, Pylon); @mentions; followers/observers; **collision detection & shared drafts** (Front); tasks on issues (Plain `T`); merge & split (Pylon); move between teams with context (Thena); emoji actions (Thena ✅/🔄; Pylon reaction triggers); Viewer seats who can add notes (Pylon).

## 7. Customer-facing
CSAT (after close, per channel), NPS surveys (Pylon), proactive issues/outbound (Pylon, Thena), **broadcasts** to many Slack channels with replies → threads (Plain, Pylon, ClearFeed, Thena, with recall in Thena), customer portal with account-level visibility, help center with AI answers.

## 8. Automation engine — synthesis
| Concept | Pylon | Plain | Zendesk | Tickzy proposal |
|---|---|---|---|---|
| Event triggers | many issue/SLA/CSAT/Devin events | 9 thread events + manual + schedule | create/update triggers + hourly automations | typed event catalogue (same as webhooks) |
| Conditions | if / else-if / delays | AND/OR/NOT, message contains, **AI prompt condition** | all/any | expression builder + AI condition with confidence |
| Actions | many + webhook + AI automations | labels, priority, assign, escalation, Sidekick step, wait | update fields, notify, webhook | deterministic + AI steps in the same graph |
| Waits | time delays | wait ≤1yr with cancel branch | hourly automations | durable waits (workflow engine) |
| Loop control | documented footguns | label-change loop prevention | run-until-stable ordering | explicit loop guard + max depth |
| Versioning | logs & history | unpublish→edit→republish | — | **versioned drafts, diff, dry-run on past issues, rollback** |
| Authoring | UI + templates | UI + templates + **describe in English** | UI | UI + templates + AI authoring + YAML/JSON-as-code via API |

## 9. What's commonly done well vs poorly
- **Done well by most:** omnichannel inbox, macros/snippets, basic SLAs, round-robin, KB, CSAT, Jira/Linear linking, email.
- **Done by few:** follow-up SLA, AI whose-turn status, AI taxonomy, backtesting, test-mode shadowing, customer cards protocol, champion-left alerts, close-the-loop status, ignored status, pull-based queues with SLA sort, capacity per channel, reply-as-yourself in Slack.
- **Done poorly / complained about:** email in chat-first tools; search (Plain); admin complexity (Zendesk); automation footguns (Pylon docs); stringly-typed webhooks (Pylon); paywalled Teams/SSO/SLA.

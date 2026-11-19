# Plain — Complete Investigation

- **Research date:** 2026-11-19
- **Mission:** M02
- **Primary sources:** [plain.com/llms.txt](https://www.plain.com/llms.txt) (dated Nov 2026), [docs llms.txt](https://www.plain.com/docs/llms.txt), [docs llms-full.txt](https://www.plain.com/docs/llms-full.txt) (2.4 MB, ~2,400 pages incl. full GraphQL reference), [pricing](https://www.plain.com/pricing), GitHub org [team-plain](https://github.com/team-plain).
- **Overall confidence:** HIGH (Plain publishes unusually detailed, dated, primary documentation including exact AI context limits and credit costs).

---

## 1. Summary

Plain (founded 2022; London + SF; $24.4M raised; ~50 employees — VERIFIED via vendor llms.txt) positions itself as **"agentic infrastructure for B2B support"**: API-first, "headless", full UI/API parity, sold to technical B2B SaaS and dev-tools companies (Vercel, n8n, Resend, Sourcegraph, Raycast, Cursor, Mintlify, Modal, Framer). It self-describes as "the Linear of customer support" — keyboard-first, opinionated, fast.

Plain's own market framing (useful and mostly accurate): **Zendesk = legacy enterprise default; Intercom = PLG chat-first; Pylon = Slack-native B2B; Plain = API-first, agentic B2B.**

---

## 2. Pricing — VERIFIED

Source: [plain.com/llms.txt](https://www.plain.com/llms.txt), [How credits work](https://www.plain.com/docs/product/billing/credits)

| Plan | Price | Limits / inclusions |
|---|---|---|
| Foundation | $45/user/mo annual ($55 monthly) | ≤5 member seats; 1,000 credits/mo; Customer Agent, Sidekick, AI workflows, Slack/email/in-app, Linear & Jira, Help Center |
| Horizon | $99/user/mo annual | 3–10 seats; 2,500 credits/mo; + **MS Teams**, SLAs & business hours, escalation paths, CRM integrations, reporting themes, AI suggested responses |
| Frontier | Custom | + multiple workspaces, SSO/SCIM, HIPAA, advanced security, CSM |

- **Unlimited viewer seats on every plan.** 7-day trial, no card. 50% startup discount.
- **Published credit costs:** Customer Agent = **100 credits per resolution** (≈ $1.00 at top-up price); Sidekick = 15–300+ credits/task; Connected (BYO) agents = 15 credits per assignment + 15 per discussion; AI-selected label/priority = 1–2 credits. Top-ups $10 / 1,000 credits, never expire; included credits expire monthly; committed annual credits expire at term end. Out of credits → agent hands off silently with internal note.
- Workflows unlimited on every plan.

**Observation:** Plain also gates MS Teams and SLAs to the $99 tier (like Pylon gates Teams to $139). The whole category treats Teams and SLAs as upsell levers.

---

## 3. Data model — VERIFIED

Sources: [What is a thread?](https://www.plain.com/docs/product/platform/threads/what-is-a-thread), [GraphQL introduction](https://www.plain.com/docs/graphql/introduction), [Headless portal](https://www.plain.com/docs/headless-portal)

- **Customer** (a person; email, externalId) → belongs to **Accounts** (formerly "companies"; maps 1:1 to the customer's org/workspace in *your* product) and optionally **Tenants** (your product's own tenancy structure) and **Customer groups**.
- **Thread** = the single unit of conversation/work (Plain does not distinguish ticket vs conversation). Has status, priority (0 Urgent – 3 Low), labels (hierarchical, typed "label types"), **thread fields** (structured custom data), assignee (user or machine user/agent), tier, SLA, escalation path, tasks, merge parent, lock.
- **Tiers** group accounts/tenants (should mirror your pricing tiers) and carry SLA targets.
- **Events**: custom **customer events** and **thread events** posted via API, rendered with **UI components** into the timeline (e.g., "User failed payment" with a "View in Stripe" button).
- **Machine users**: API identities with multiple API keys, each key with **fine-grained permissions**; "Agent" machine users for BYO agents. OAuth apps act as a user ("Sign in with Plain").
- Thread references like `T-15086`.

### Status model (3 groups, 7 statuses)
| Group | Status | Semantics |
|---|---|---|
| Todo | Needs first response | First-response SLA applies |
| Todo | Needs next response | Customer replied; next-response SLA |
| Todo | Investigating | Internal deep work |
| Todo | **Close the loop** | Linked known issue resolved → auto-moved so agent follows up |
| Snoozed | Waiting for customer | Default after reply |
| Snoozed | Paused for later | |
| Done | Done | Reopens on customer reply |
| Done | **Ignored** | Silenced: no notifications, no metrics, no status changes — for noisy multi-use Slack channels |

Plus **Locking** (permanent; customer reply creates a new thread).

**Tickzy implication:** "Close the loop" (auto-resurfacing threads when the linked bug ships) and "Ignored" (noise that never pollutes metrics) are two small, high-value statuses missing from many helpdesks. Tickzy should adopt both.

---

## 4. Channels & Slack ingestion — VERIFIED

Source: [Ingestion modes](https://www.plain.com/docs/product/channels/slack-ingestion-modes), docs index

Channels: Slack (shared channels, in-Slack actions, Slack discussions, digests, workflow forms), MS Teams (shared channels; store app), Discord, Discourse, email (DKIM/SPF setup, forwarding, BCC addresses, alternate addresses, spam & auto-reply detection), in-app chat (authenticated), contact forms, API.

**Slack ingestion modes** — the clearest public specification of the "chat → ticket segmentation" problem in the market:
1. **Time-based (default):** same user within 2h = one thread; different users within 1h = one thread.
2. **AI-based (recommended):** semantic grouping of top-level messages.
3. **One-to-one:** each Slack thread = one Plain thread.
4. **Manual emoji:** only ingest when a team member reacts with a configured emoji (optionally customers too).
- Grouping stops once the last message has a reply (from team, agent or workflow); configurable workspace default + per-channel override + audience overrides.

**Tickzy implication:** offer these same modes plus a "confidence + preview" UI and a post-hoc split/merge, and learn per-channel which mode fits. This is a core B2B differentiator area.

---

## 5. SLAs & business hours — VERIFIED

Source: [How SLA time is counted](https://www.plain.com/docs/product/platform/slas/sla-time)

Very rigorous semantics worth copying as a spec:
- Amount of time fixed when the clock starts; hours decide *when* it runs; time already counted stays counted; **remaining time follows current hours** (editing schedules/overrides moves running deadlines); finished targets (Achieved/Breached/Canceled) are final.
- **Multiple schedules per target** (e.g., London + New York) → counts while any is open; per-schedule overrides (holidays).
- Resolution targets can **pause** in selected statuses (exact remaining time held); response targets don't pause but cancel/keep running on snooze.
- States: running, imminent breach (warn once), breaching, achieved, canceled.
- **Tier SLAs** + SLA policies; business-hours overrides manageable via API (sync company holiday calendar).

---

## 6. Workflows (automation) — VERIFIED

Sources: [Triggers](https://www.plain.com/docs/product/workflows/workflows-triggers), [Conditions](https://www.plain.com/docs/product/workflows/workflows-conditions), [Wait for](https://www.plain.com/docs/product/workflows/workflows-wait-for)

- Visual multi-step branching builder; manual ("Run workflow" on a thread) or automatic triggers: thread created, message added, labels changed, tier updated, escalated, priority changed, status changed, thread field created/updated; also schedules.
- **Loop prevention:** a workflow's own label change does not start other "Labels changed" workflows.
- One run per event; ordered "run order" per event; waits (1s–1yr) with Completed/Canceled branches don't block later workflows.
- Conditions: AND/OR/NOT; message-contains (customer/user/any, case-insensitive, comma = OR, whole-word toggle, bot replies skipped); **AI prompt condition** (context = up to 600 most recent messages × 3,000 chars + metadata + customer + channel) → Yes/No branch. Templates: triage security emails, detect spam, follow up inactive customers, route enterprise threads to account owners.
- Actions include AI-selected labels/priority, set escalation path, Sidekick Agent action step, start agent discussion.
- To edit a published workflow you must unpublish → edit → republish (versioning is weak — opportunity).
- Sidekick can **build a workflow from a plain-English description**.

---

## 7. AI agents — VERIFIED (incl. providers)

Sources: [Handoffs](https://www.plain.com/docs/product/agents/ari/handoffs), [Test mode](https://www.plain.com/docs/product/agents/ari/test-mode), [Context](https://www.plain.com/docs/product/agents/ari/context), [Actions and approvals](https://www.plain.com/docs/product/agents/sidekick/actions-and-approvals), [AI triage](https://www.plain.com/docs/product/platform/ai-triage), [AI and your data](https://www.plain.com/docs/product/security/ai-and-your-data)

**Providers: OpenAI and Anthropic** (VERIFIED, named sub-processors; OpenAI ZDR opted in). AI can be turned off workspace-wide or per feature.

### Customer Agent (formerly "Ari")
- Context snapshot rebuilt per customer message: last **50 messages**, truncated to **2,000 chars**, quoted email history/signatures stripped; customer details, channel, thread ref, attachments, tone-of-voice, labels; optional thread fields; retrieved knowledge passages.
- Budget: **up to 6 rounds of search+write and 45 seconds** per message, else fixed handoff message.
- **Default handoff policy** (excellent, specific): customer asks for a human; knowledge doesn't answer (→ records **knowledge gap**); needs an action it can't take (refund); abuse/churn threat (frustration alone isn't); sales requests; feature requests; **outage → hand off immediately + set Urgent**; security incident → High.
- Hard stops: once any human (or integration as machine user) replies, the thread belongs to humans **for good**; customer tags a user in Slack; out of credits; replied 3× to an automated sender (bot-loop guard); nothing indexed; error.
- **Test mode:** runs on real threads, sends nothing, writes private timeline entries ("would have replied / handed off / not responded"); joins as *additional* assignee so queues unaffected; mode chosen per assignment so it can be live on one queue and test on another. Also Playground and "test changes".
- Citations, suggested responses, typing indicator, tone of voice, knowledge sources & **knowledge gaps** API (record gap signals from your own agent).

### Sidekick Agent (team-facing)
- Investigates across logs, code, issue tracker, past threads (plugins: Jira, Linear, Datadog, incident.io…), drafts replies, builds workflows from English, runs in threads, Slack, and as a **workflow step**.
- **Action classification:** "runs directly" (assign, labels, priority, rename, fields, internal note, link Linear/Jira, draft/publish Help Center articles) vs "requires approval" (status change, escalate, merge, …). Approve/deny cards also in Slack. BYO agents use the same approval cards for their own tool calls.
- Skills.

### Connected agents (BYOA)
- Any external agent connects via API as an "Agent" machine user with same capabilities as Plain's agents (reply, investigate, notes, hand off). Vercel runs its own agent on Plain (claims −65% ticket volume). Third-party agent partners listed: Decimal, Duckie, Parahelp, Inkeep, Fin.ai.

### AI triage
- AI-selected labels (≤2 per run, only labels with "Apply with AI" on, uses label descriptions & parents, first 500 labels) and priority (explicit rubric; **when unsure pick the lower priority**; never overrides a human/API-set priority). Reads title + last 30 timeline entries. 1–2 credits.
- Thread titles, summaries ("catch-ups"), similar threads, AI slash commands, translation, speech-to-text.

**Tickzy implication:** Plain's docs are effectively a reference design for a safe support agent: explicit context budgets, step/time budgets, enumerated handoff rules, bot-loop guards, human-ownership lock, test-mode shadowing, action risk classes with approvals. Tickzy should adopt this whole pattern and expose the policies as editable, versioned config.

---

## 8. Developer platform — VERIFIED

- **GraphQL API with full UI parity** (the Plain app is built on its public API); REST too; schema at `/schema.graphql`; open-source typed **TypeScript SDK**; Webhooks SDK with typed parsing and signature verification; MCP server; OAuth apps.
- Regional endpoint e.g. `core-api.uk.plain.com/graphql/v1` (UK region exists — PARTIALLY VERIFIED via third-party connector docs + docs IP list for "UK region").
- **Webhooks:** event-type subscriptions per **webhook target** (max 25/workspace), HTTPS only, basic-auth in URL, **request signing and mTLS**, static IPs, **at-least-once with `id` idempotency key**, 2xx = success, versioned payload schemas. Example servers repo.
- **Customer cards:** Plain POSTs to *your* API when a thread is viewed (customer email/id/externalId, thread id, account id, card keys) → you return JSON cards built from **Plain UI components** (declarative: text, badges, link buttons, rows…) — a live, pull-based context protocol with caching/TTL. Open-source example repo.
- **Headless portal:** build your own portal on the API (accounts ↔ your orgs).
- "No restrictive rate limits" (vendor claim; SDK has typed `RateLimitError`). UNVERIFIED limits.

**Tickzy implication:** Customer Cards (pull-based, declarative UI components, rendered in sidebar) is the best "bring your own context" design seen. It is simpler and safer than iframes (Pylon) or full apps frameworks (Zendesk/Front). Tickzy should implement a compatible-in-spirit "Context Cards" protocol.

---

## 9. Reporting — VERIFIED (docs index)

Dashboards (build/configure charts), metrics reference, support volume, heatmaps, FRT, NRT, resolution time, **customer waiting time**, SLA compliance, team reporting, top issues, **themes** (AI grouping of what customers say), CSAT; reporting API (time series, single value, heatmap).

---

## 10. UX notes — PARTIALLY VERIFIED (docs + marketing)

- Keyboard-first: `P` priority, `T` task, `⌘K` command palette for every action, "My threads", favorites, saved views.
- Online/offline/away mode, working hours, personal notifications.
- Snippets (saved replies), auto-responses by channel/business hours/label.
- Similar threads in sidebar; thread catch-up summaries.

---

## 11. Weaknesses / gaps observed

- Seat caps (Foundation ≤5, Horizon ≤10) push growing teams to custom pricing quickly.
- Workflow versioning: unpublish-edit-republish.
- Less CS/account-intelligence depth than Pylon (no health scores, notebooks, call recording ingestion — not found in docs index). PARTIALLY VERIFIED (absence of evidence).
- Fewer channels than Pylon (no WhatsApp/SMS/phone found in docs index). PARTIALLY VERIFIED.

## 12. Takeaways for Tickzy
1. API-first + UI parity is a real wedge with technical buyers; it requires building the product *on* the public API from day one (architectural decision, see `docs/tickzy/recommended-architecture.md`).
2. Copy the rigor: SLA semantics, handoff policy, context budgets, test mode, action approval classes, typed webhooks with signing/mTLS.
3. Plain proves published per-resolution AI pricing (~$1) is accepted by the market; Intercom Fin charges $0.99/outcome. Tickzy must be ≤ this or bring-your-own-key.

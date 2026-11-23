# Tickzy — UX Architecture & UI Specification (v1.0)

- **Date:** 2026-11-19 · Visual reference: design canvas https://claude.ai/artifact/BvvyCE24er29B2iYNqLVxg (source in `design/canvas/`).
- **Pattern sources:** Plain (keyboard, ⌘K, ingestion modes, test mode), Pylon (kanban statuses, internal-thread tabs, sidebar context, taxonomy), Linear (speed, optimistic UI, list density), Front (collision detection, shared drafts, inline comments), Intercom (AI suggestion UX, tracker tickets), Zendesk (views, macros, side conversations), Thena (AI logs tab). Evidence: `docs/research/ux-research/product-experience.md`.

## 1. Information architecture
```
Workspace
├─ Overview (dashboard)
├─ Inbox
│   ├─ Views: All · Waiting on us · On customer · AI agent · Mine · Unassigned · Breaching · Saved views…
│   └─ Issue (conversation | details | AI log | linked)
├─ Accounts → Account (overview, issues, contacts, channels, activity)
├─ Contacts → Contact
├─ Problems → Problem (GA)
├─ AI agent (overview, behavior, knowledge, actions & approvals, tests) 
├─ Knowledge (sources, articles, gaps, help center settings)
├─ Workflows (GA)
├─ Analytics (overview, team, SLA, channels, AI, product areas)
└─ Settings
    ├─ Workspace (general, members & roles, teams, business hours, statuses, labels, fields)
    ├─ Channels (Slack, email, widget, Teams…)
    ├─ SLA policies · Routing · Snippets
    ├─ Integrations (Linear, Jira, CRM) · Developers (API tokens, webhooks, MCP, context cards)
    ├─ AI (models & spend, data controls)
    └─ Security (SSO, audit log, retention) · Billing
```
**Navigation:** left sidebar (≥1280px full, 1024–1279 icon rail, <768 bottom tab bar: Home, Inbox, Mine, Accounts, More). Top bar: global search (⌘K palette), New issue, theme toggle, notifications, profile. URLs are the source of truth for view state (`/inbox?view=on-us&sort=sla&issue=iss_…`).

## 2. Design system
### 2.0 Design system v2 (founder direction, 2026-11-23)
Supersedes the v1 visual language (indigo accent, cards on a tinted background) and the visuals of the design canvas in `design/canvas/` (structure and flows still apply). Reference: founder-supplied mock-ups — calm neutral canvas, one white content panel, near-black primary actions, outlined status pills, colour used only in data.
- **Layout:** sidebar sits on the canvas (`--bg`); all content lives in one white panel (`--panel`, radius 16, 1px border) beside it. Sidebar sections: logo + collapse toggle (remembered), *Quick actions* (search), *Menu*, *AI & insights*, *Workspace*, *Help & support* (keyboard shortcuts), user card at the bottom. 768–1279px: icon rail; <768px: bottom tabs.
- **Top bar:** breadcrumb `Workspace ▾ / Page` (the workspace name is a real switcher), search pill ("Search issues or press /", `/` and `⌘K` focus it, Enter opens the inbox filtered by text), icon buttons (theme, New issue), account menu (avatar → keyboard shortcuts, sign out). No bell or chat icons until notifications exist (no fake UI).
- **Page header:** large title (32px, weight 500) + subtitle; secondary (white, bordered) and primary (near-black) actions on the right.
- **KPI strip:** one card split into equal cells (icon + label, big number, delta or caption, 14-day mini chart as dot-matrix or thin bars). Every number comes from `GET /v1/issues/stats`; missing values render "—".
- **Table card:** title + subtitle, segmented tabs with counts, search field, Filter; table header on `--surface-2`; rows with initials avatar + two-line cells; outlined status pills; row actions right-aligned (primary for the main action); Previous / Next paging. Fixed column layout so actions never clip; secondary columns fold into the second line below 1536px; phones get stacked cards.
- **Status pills:** outlined (border + text in the tone, no fill). Priority: coloured dot.
- **Avatars:** initials only (no photos are stored; never invented).
- **Accessibility:** a control's accessible name always contains its visible text (WCAG 2.5.3); screen-reader-only context (e.g. ", ACME-12") is appended inside the same text run.

### 2.1 Tokens (CSS variables; light / dark) — v2
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #F1F1F3 | #0C0C0E | canvas (behind the panel; sidebar) |
| `--panel` | #FFFFFF | #131316 | main content panel |
| `--surface` | #FFFFFF | #18181B | cards |
| `--surface-2` | #F6F6F7 | #1F1F23 | inputs, table header, hovers, segmented control |
| `--border` | #E6E6E9 | #2A2A30 | 1px borders |
| `--text` / `--muted` | #17171A / #6B6B74 | #F2F2F4 / #A1A1AA | text |
| `--primary` / `--primary-text` | #111113 / #FFFFFF | #F2F2F4 / #111113 | primary buttons, logo tile, agent message bubbles |
| `--accent` / `--accent-soft` / `--accent-text` | #4F46E5 / #EFEFFD / #4338CA | #8B85FF / #23213F / #BCB8FF | focus ring, links, selection only |
| `--success`, `--warn`, `--danger`, `--info` (+ `-bg`) | green / amber / red / blue | lifted variants | status tones, deltas |
| `--chart-1..5`, `--chart-empty` | #F97316, #7C3AED, #DC2626, #16A34A, #2563EB, #DCDCE0 | lifted variants | KPI mini charts |
Theme: system default, user override persisted; `data-theme` on `<html>`. Primitives (buttons, inputs, cards, segmented control) live in `apps/web/src/components/ui.ts`.

### 2.2 Typography (Inter; system fallback)
Metric 30/36 600 · Page title 24/32 600 · Section/card title 15/22 600 · Body 14/21 400 · Secondary 13/20 · Caption 12/16 · Label caps 11/16 600 +0.08em. Tabular numbers for metrics/SLA timers.

### 2.3 Spacing, radius, elevation
4px grid; page padding 32 (desktop) / 16 (mobile); card padding 20 / 14; gaps 16 / 12. Radius: cards 16, panes 0, controls 10–12, chips 6–7, avatars 50%. Elevation: borders by default; shadow only for popovers/menus/dialogs (`0 8px 24px rgba(17,20,39,.12)`).

### 2.4 Components (implementation list, `packages/ui`)
Button (primary, secondary, ghost, danger; sm 32 / md 40 / lg 44 heights; icon-only requires aria-label) · IconButton · Input/Textarea/Select/Combobox (React Aria) · Checkbox/Switch/Radio · Chip/Badge (tones: neutral, ai, success, warn, danger) · Avatar (initials fallback) · Card · Tabs/SegmentedControl · Table (sortable, sticky header, row selection) · VirtualList · Menu/Popover/Tooltip · Dialog/Sheet/Drawer · Toast · CommandPalette · Kbd · EmptyState · Skeleton · SLA Timer pill · Priority dot · Status pill · Channel badge · MessageBubble (customer, agent, AI, internal note, system event) · Composer (reply/note modes, snippets, AI rewrite, attachments) · AISuggestionCard (sources, confidence, use/edit/regenerate) · PropertyRow · Chart primitives (bar, stacked bar, gauge) · Sidebar/TopBar/BottomTabBar.

### 2.5 Interaction rules
- Optimistic updates for status/assignee/priority/labels with rollback toast on failure.
- Keyboard: `⌘K` palette, `/` search, `j/k` next/prev issue, `Enter` open, `r` reply, `n` internal note, `a` assign, `s` status, `p` priority, `l` label, `e` resolve, `⌘↵` send, `Esc` close/back, `?` shortcut sheet. Shortcuts are discoverable in menus and tooltips.
- Collision: avatars of other viewers in the issue header; "X is typing" in composer; draft conflicts warned.
- Every automatic change shows *why* (hover/expand on timeline event: rule/AI/model/sources).
- Loading: skeletons ≤ 300ms; never spinner-only pages.
- Motion ≤ 150ms, respects `prefers-reduced-motion`.

### 2.6 Responsive behavior
| Width | Layout |
|---|---|
| ≥1280 | Sidebar 248 + content; Inbox 3 panes (queue 320–360, conversation flex, details 300) |
| 1024–1279 | Sidebar → 64px icon rail; Inbox details → right drawer toggled by `i` |
| 768–1023 | Icon rail; Inbox: queue + conversation; details drawer |
| <768 | Bottom tab bar; single pane stack: queue → issue (Conversation / Details segmented) → sheets for property edits; composer pinned above keyboard; 44px touch targets; swipe actions on queue rows (resolve, snooze) |

### 2.7 Accessibility (WCAG 2.2 AA)
Contrast ≥4.5:1 (text) both themes; visible 2px focus ring `--accent`; all actions keyboard reachable; landmarks (`nav`, `main`, `aside`); live region for new messages/toasts; color never the only signal (SLA pills carry text); reduced motion; touch targets ≥44px on touch devices; form labels always; screen-reader names for icon buttons.

## 3. Screen specifications
Each screen lists purpose, layout, content, states, actions, permissions.

### S1 Overview (`/`)
Purpose: daily health. Layout: header (title, date range, channel filter, export) → 4 KPI cards (Open issues, Median first response, SLA compliance, AI resolution rate; delta chip vs previous period) → Volume by channel (stacked weekly bars) + First response by day → SLA at risk table (links to issue) + AI outcomes gauge → Accounts needing attention + Top product areas. States: empty workspace → onboarding checklist card (connect Slack, connect email, invite team, set business hours). Permissions: all members; collaborators see own-team scope.

### S2 Inbox (`/inbox`)
- **Queue pane:** view tabs with counts; filter (status, priority, channel, account, tier, assignee, team, label, product area, SLA state); sort (SLA due default, newest, oldest, priority); row = priority dot, account, SLA pill, title, 2-line preview, channel badge, status chip, time; unread bold; multi-select with bulk bar (assign, status, label, merge). Virtualised; keyset pagination.
- **Conversation pane:** header (key, channel/location, title inline-editable, viewers, actions: snooze, link problem, merge, resolve); timeline of MessageBubbles and system/AI events (collapsible); tabs **Conversation | Internal threads | AI log | Linked** (Pylon tabs + Thena AI log); AI suggestion card above composer; composer with Reply/Internal note modes, "replies in #channel as <you>" hint, snippets, attachments, AI rewrite, send ⌘↵.
- **Details pane:** account card (tier, ARR, owner, open issues, plan/region from context cards), SLA timers with bars, properties (status, priority, assignee, team, product area with AI badge, labels, custom fields), engineering links (create/link Linear/Jira; status), similar issues, requester & participants.
- States: no selection (keyboard hint), loading, delivery failed (inline retry), conversation locked/closed, AI disabled.

### S3 Issue full page (`/issues/:key`)
Same as panes 2+3 at full width; shareable URL; print view.

### S4 Accounts list & Account profile (`/accounts/:id`)
List: name, tier, ARR, owner, open issues, last activity, health/signals; filters; bulk owner change. Profile: header (logo initials, tier, ARR, owner, domains, CRM link), tabs Overview (signals, open issues, SLA performance, channels), Issues, Contacts, Channels (Slack/Teams/email endpoints mapped), Activity timeline, Notes.

### S5 Contact profile
Identities (email, Slack, Teams), account, issues, recent messages; merge contacts.

### S6 AI agent (`/ai`)
Tabs: Overview (KPIs with strict definitions, per-queue Live/Shadow switches, spend & limits, model routing, handoff rules, knowledge gaps), Behavior (tone, instructions, handoff policy editor — versioned), Knowledge (sources & sync status), Actions & approvals (tool list with risk class, approval routing), Tests (backtests: create dataset, compare versions, review results with Pass/Fail/N-A and feedback → suggested fixes). Publishing a new version requires a backtest unless admin overrides (logged).

### S7 Workflows (GA) (`/workflows`)
List (name, trigger, last run, runs 7d, errors, status). Builder: vertical flow — Trigger card → Condition blocks (AND/OR/NOT, AI condition with prompt + test) → Action steps → Wait steps with cancel branch. Right panel: step config. Toolbar: Test on past issues (dry-run results list), Version history (diff, restore), Publish. Templates gallery. Errors surfaced per run with step logs.

### S8 Knowledge (`/knowledge`)
Sources (docs URL crawl, manual articles, resolved issues opt-in) with sync status; Articles (editor with review state, visibility public/internal); Gaps (question cluster, frequency, "Draft article" → AI draft → review); Help center settings (GA).

### S9 Analytics (`/analytics`)
Dashboards: Overview, Team (per agent: handled, FRT, resolution, CSAT), SLA (compliance by policy/tier/channel, breaches list), Channels, AI (resolution funnel, handoff reasons, cost), Product areas. Global filters; CSV export; every metric has a definition tooltip.

### S10 Settings & administration
Standard two-column settings (nav left, form right) with sticky save bar. Key screens: Members & roles (invite, role, collaborator free label), Teams (members, assignment strategy), Business hours (weekly grid, holidays, timezone, preview), SLA policies (conditions + targets + pause rules + **preview on recent issues**), Channels/Slack (connect, channel list with type and ingestion mode, triage channel, bot identity, reply-as-user), Email (addresses, forwarding instructions, DNS records with live verification), Widget (install snippet, identity verification secret, theme), Integrations, Developers (tokens shown once, webhooks with event picker + delivery log + replay), AI (provider/BYO key, spend cap, data controls, per-feature toggles), Security (SSO, audit log viewer with filters/export, retention), Billing.

### S11 Onboarding
1) Create workspace (name, issue prefix) → 2) Connect Slack (OAuth) and pick channels (bulk select customer channels, set triage channel) → 3) Connect email (forwarding address + verify) → 4) Invite team → 5) Business hours & default SLA template → 6) "Send a test message" checklist. Target <30 min (strategy metric).

## 4. Key workflows (happy paths & edge cases)
| ID | Workflow | Steps | Edge cases |
|---|---|---|---|
| W1 | Triage a new Slack request | message arrives → issue in Triage with AI title/priority/area → agent opens (j/k) → assign self (a) → reply (r, ⌘↵) → status auto → Waiting on customer | multiple top-level messages grouped by mode; customer edits/deletes message; bot loops |
| W2 | Reply with AI draft | open issue → suggestion card visible → Use draft → edit → send → AI action marked accepted | low confidence → card collapsed with "why"; sources internal-only → not shown to customer |
| W3 | Escalate to engineering | `Create Linear issue` → AI prefilled repro + links → issue Blocked → follow-up SLA → Linear done → status Waiting on us + close-the-loop prompt | ticket deleted in Linear; many issues on one ticket |
| W4 | Internal discussion | Internal note (n) or Internal thread → posted to triage Slack channel → replies sync back | thread started in Slack and synced via shortcut |
| W5 | SLA breach prevention | timer warning → appears in Breaching view + Slack alert → reassign | business hours changed while running |
| W6 | Merge/split | select two issues → merge (keep primary) / select messages → split to new issue | cross-account merge blocked |
| W7 | Mobile triage | push/Slack notification → open link → mobile issue → reply/assign | offline → queued send with clear state |
| W8 | Configure SLA | create policy → conditions → targets → preview on last 50 issues → save | overlapping policies → first match by order |
| W9 | AI agent rollout (GA) | enable shadow on queue → review would-have-replied entries → backtest → switch queue Live | spend cap reached → hand off |

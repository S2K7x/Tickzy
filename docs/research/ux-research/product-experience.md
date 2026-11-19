# UX / Product Experience Reconstruction

- **Research date:** 2026-11-19 · **Mission:** M19
- **Sources:** vendor docs describing UI behaviour (Pylon [Views](https://docs.usepylon.com/pylon-docs/support-workflows/issues/views.md), [Statuses](https://docs.usepylon.com/pylon-docs/support-workflows/issues/statuses.md) (kanban, `s` shortcut), [Internal threads](https://docs.usepylon.com/pylon-docs/support-workflows/issues/internal-threads.md) (tabs, yellow overlay), [Command Search](https://docs.usepylon.com/pylon-docs/platform/command-search.md); Plain [Priorities](https://www.plain.com/docs/product/platform/threads/priorities) (`P`, ⌘K), [What is a thread](https://www.plain.com/docs/product/platform/threads/what-is-a-thread) (`T` tasks), [Similar threads](https://www.plain.com/docs/product/platform/threads/similar-threads), [Test mode](https://www.plain.com/docs/product/agents/ari/test-mode) (private timeline entries); Thena [Window](https://docs.thena.ai/guides/ticketing/window.md), [AI logs](https://docs.thena.ai/guides/ticketing/ai-logs.md); Front collision detection/shared drafts (product knowledge); review themes (`customer-feedback/review-analysis.md`).
- **Limitation (important):** screenshots and YouTube walkthroughs were **not** analysed in this pass (no video/image pipeline used). Layouts below are reconstructed from documentation text → **PARTIALLY VERIFIED**. Next task: capture public demo videos/interactive demos (Pylon "Interactive Demos", Plain trial) and annotate.

## 1. Reconstructed layouts

### Pylon (agent app)
- Left sidebar: Issues (views), Accounts, Customer Overview (boards of signals/views), Knowledge Base, Analytics, Broadcasts, Settings; command search.
- Issues: **Kanban by status** (drag between New / On You / On Customer / On Hold / Closed) or list/table; saved views with filters/columns/layout.
- Issue view: header (status `s`, priority, assignee, team); **tabs across the top = conversations** (external conversation + overlaid internal notes in yellow/orange; additional tabs for internal Slack threads and linked Jira/Linear discussions); message editor that replies to the source channel or posts internal note; **Copilot** AI icon in formatting bar; right **sidebar** with account, contact, fields, SLA timers, taxonomy area, linked tickets, runbooks.
- Account view: notebooks of drag-and-drop blocks, activities timeline, AI fields, health.

### Plain
- Keyboard-first, Linear-like: ⌘K palette for every command; single-letter shortcuts (`P` priority, `T` task); "My threads", favourites, saved views; thread sidebar with customer cards (live from your API), similar threads, thread fields; timeline mixing messages, events (custom UI components), private AI test-mode entries.

### Thena
- Ticket "window": AI-generated editable title + long description, conversation with internal threads, forms & fields, tabs for Conversation / Notes / Activity / **AI logs**.

### ClearFeed
- Optional "no web app" workflow: reply/assign/close from a Slack triage channel.

## 2. Excellent patterns (adopt)
1. **Command palette + single-key shortcuts** for every action (Plain, Pylon). Target: zero-mouse triage.
2. **Status-as-kanban** for small teams, list for large (Pylon).
3. **Conversation tabs** separating external thread from internal threads/engineering discussions, with internal content visually distinct (Pylon yellow).
4. **Live context cards** in sidebar from customer's systems (Plain).
5. **Similar threads** in sidebar (Plain) → reduces search.
6. **Catch-up summaries** when opening a long thread (Plain) / AI title+description (Thena).
7. **AI activity visible in timeline** (Thena AI logs, Plain test-mode entries).
8. **Collision detection + shared drafts** (Front).
9. **Emoji actions** from Slack (Thena, Pylon triggers, Plain manual-emoji ingestion).
10. **Viewer seats** for engineers/sales to read and add notes without cost (Pylon, Plain unlimited viewers).

## 3. Friction & anti-patterns (avoid)
- Configuration sprawl: SLA policy + separate trigger to apply it (Pylon) = two places to edit; Tickzy: policy contains its own applicability rules.
- Unpublish→edit→republish workflows (Plain).
- Fields AI can set but humans cannot override (Pylon taxonomy).
- Paywalled basics surfacing as "upgrade" walls mid-workflow.
- Search that can't find past threads (Plain G2).
- Email rendering issues (images, threading) in chat-first tools (Pylon G2).
- Mobile neglected (Libredesk HN; most helpdesks) — B2B agents do triage on phones (Slack is mobile) → at least a responsive triage view + Slack-based actions.

## 4. Time-saving features ranked (hypothesis, to validate with user interviews)
1. Correct automatic routing + whose-turn status (no manual status hygiene).
2. Grounded AI draft with citations, one-key accept/edit.
3. Context in one screen (account, plan, recent issues, health, open incidents).
4. Similar-issue + linked engineering ticket status.
5. Bulk actions + macros.
6. Slack-native actions (reply/assign/close/approve from Slack).

## 5. Customer-experience features
Replies in the same channel/thread the customer used; human identities (reply-as-yourself); proactive status updates (follow-up SLA); incident broadcasts; portal with org-wide visibility controls; honest AI disclosure + instant human escalation.

## 6. Proposed Tickzy UX principles
1. Speed is a feature (p95 interaction <100 ms local, optimistic updates).
2. Keyboard-first, mouse-friendly.
3. One screen of context; progressive disclosure for admin.
4. Everything explainable ("why is this assigned to me / why this SLA / why did AI do this").
5. Defaults that work on day one (templates per company size), AI-assisted setup.
6. Accessibility (WCAG 2.2 AA) from v1.

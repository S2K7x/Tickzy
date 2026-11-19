# Thena — Investigation

- **Research date:** 2026-11-19 · **Mission:** M05
- **Primary sources:** [thena.ai/llms.txt](https://www.thena.ai/llms.txt), [pricing](https://www.thena.ai/pricing), [docs llms.txt](https://docs.thena.ai/llms.txt) and docs pages: [Routing](https://docs.thena.ai/guides/ticketing/routing.md), [SLAs](https://docs.thena.ai/guides/ticketing/slas.md), [Statuses](https://docs.thena.ai/guides/ticketing/statuses.md), [Window](https://docs.thena.ai/guides/ticketing/window.md), [Emoji actions](https://docs.thena.ai/guides/ticketing/emoji-actions.md), [AI logs](https://docs.thena.ai/guides/ticketing/ai-logs.md), [Recruitment](https://docs.thena.ai/guides/ai-agents/recruitment.md), [Flows](https://docs.thena.ai/guides/ai-agents/flows.md), [Executions](https://docs.thena.ai/guides/ai-agents/executions.md), [Slack authorization](https://docs.thena.ai/guides/preferences/slack-authorization.md). Secondary: [Product Hunt](https://www.producthunt.com/products/thena-for-customer-support/launches), [unthread review](https://unthread.io/blog/thena-review/).
- **Confidence:** HIGH (features, pricing); MEDIUM (customer list from Product Hunt claims: Vercel, Amplitude, FOX, Etsy, LaunchDarkly — note Vercel is also a public Plain customer, so this may be outdated).

## 1. Positioning — VERIFIED
"AI customer support platform for B2B" across Slack, email, web chat, MS Teams, Discord. Strong Slack heritage (Slack triage). "AI is the baseline" — AI features included on every plan rather than metered add-ons.

## 2. Pricing — VERIFIED ([thena.ai/pricing](https://www.thena.ai/pricing), Nov 2026)
| Plan | Price (annual) | Notes |
|---|---|---|
| Free | $0 | "Free plan available with no credit card" (llms.txt) |
| Starter | $29/user/mo | ≤5 seats, ≤1,000 tickets/mo, Slack & email |
| Standard | $79/user/mo | + AI web chat, AI agent studio; 30-day trial |
| (Top) | $119/user/mo | + AI agent custom deployments |
AI included at all tiers: ticket detection, summaries, tagging, assistant, auto-responses, copilot, AI workflows.

## 3. Ticketing model — VERIFIED
- **Teams → Groups** (specialisation/timezone) → members. Rule-based routing (ALL/ANY conditions on form selections, tags, source) to groups; **default fallback group**; each group owns its assignment strategy.
- Custom statuses under 4 fixed parents: **Open, In progress, On hold, Closed** (vs Pylon's 5 and Plain's 3 groups).
- SLA policies with conditions incl. **sentiment** as a condition (unusual), pause options.
- **Forms determine fields** in the ticket window (text/date/checkbox/dropdown/lookup); AI-generated editable title + long-form description.
- Internal threads, related tickets (cross-department), **move tickets between teams** preserving context, **emoji actions** (✅ resolve, 🔄 reopen…), auto-responder, CSAT, snippets, proactive tickets, customer portal, CSV export, **draft tickets**, account mapping on creation, "work units" (platform concept, unexplored).
- **Slack authorization: agents reply as themselves** (user token) instead of via a bot — maintains native feel. (Pylon/Plain also offer variants; this is an important B2B UX detail: customers in shared channels respond better to humans than bots.)

## 4. AI — VERIFIED
- "Recruit" AI agents; each agent = multiple **Flows** (one task per flow: L1 deflection, title generation…), each flow = **prompt** + knowledge (files PDF/TXT/CSV/DOCX, URLs) + tied to workflows (triggers/filters) + shared tone/language/personality + **permissioned tool access**.
- **Executions** page: per flow run — flow name, trigger source, input, output, time.
- **AI logs** tab on every ticket: status changes, fallbacks to humans (with reason: policy, confidence, unknown intent), field updates, ticket associations, summaries.
- MCP support, APIs, webhooks (private webhook app receiving all platform events).

## 5. Account layer — VERIFIED
Accounts view, tasks, notes (collaborative), activity (calls, meetings), account & contact fields; broadcasts (email + Slack, static/dynamic audiences, analytics, **recall**).

## 6. Tickzy takeaways
1. A per-ticket **"AI log" tab** (every AI action with reason) + global execution log is a strong trust pattern → Tickzy should make AI activity a first-class, filterable timeline event type.
2. Reply-as-yourself via Slack user tokens matters for B2B authenticity; needs per-user OAuth and careful scope design.
3. Including AI in seat price (no metering) is a positioning lever for SMB; risky at scale without fair-use limits.
4. Broadcast "recall" (unsend) is a nice safety feature.

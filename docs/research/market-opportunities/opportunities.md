# Market Opportunities (the 10 questions from the brief)

- **Research date:** 2026-11-19 · **Mission:** M29 (competitive feature consolidation)
- Evidence references point to dossiers in `docs/research/`.

1. **Features almost every competitor implements well:** omnichannel inbox, email basics, macros/snippets, basic SLAs, round-robin, help center, CSAT, Jira/Linear linking, AI drafts, AI agent v1. → *Table stakes; must match, not differentiate.*
2. **Features only a few offer:** follow-up SLA (Pylon), AI whose-turn status (Pylon), Slack ingestion modes (Plain), close-the-loop & ignored statuses (Plain), customer cards protocol (Plain), backtesting (Pylon), shadow test mode (Plain), action approval classes (Plain), AI logs tab (Thena), reply-as-yourself (Thena), champion-left alerts (Pylon), capacity per channel & pull queues (Pylon), usage pricing w/ unlimited agents (ClearFeed), day passes (Freshdesk), BYO LLM (Foqal). → *Combine all of them in one product = strong differentiation.*
3. **Implemented poorly:** email in chat-first tools (Pylon G2), search (Plain G2), webhooks (Pylon string templates, 3 retries), automation footguns (Pylon docs), workflow editing (Plain unpublish), admin complexity (Zendesk), AI metrics honesty (vendors' resolution definitions), API limits (Gorgias, Pylon, Front).
4. **Repeatedly requested:** company-level (account) support in generic tools (HN Fogbender), bidirectional Jira sync (HN Libredesk), better email threading/images (Pylon), Teams parity, confidence in AI answers (HN Inkeep), predictable pricing (all).
5. **Common complaints:** cost creep/opacity, AI inaccuracy & loops, complexity, lock-in, vendor support quality, Salesforce stewardship fears (Fin).
6. **Unnecessarily complicated:** SLA policy + separate trigger to apply it; trigger ordering semantics; conversation vs ticket double-trigger; credit systems with opaque per-action costs; seat caps per tier.
7. **Missing integrations:** few vendors connect product-usage/billing data natively (solved generically by context cards + actions); limited Google Chat/Discord outside Pylon; warehouse sync only on top tiers.
8. **Missing automation:** simulation/dry-run over history; versioned workflows with rollback; automation as code via API; SLA-risk prediction (pre-breach routing); auto-created Problems from clustered similar issues during incidents (Pylon anomaly detection partially).
9. **Unexploited AI opportunities:**
   - *Support → engineering loop:* AI-written reproduction + logs into the engineering ticket, dedupe against existing tickets, notify all affected accounts on fix (beyond Pylon/Plain partial).
   - *Docs maintenance from tickets:* gap → draft → review → publish → backtest (Promptless-style automatic doc updates, HN 107 pts).
   - *Account-risk signals* from conversation sentiment + volume + champion changes, explained.
   - *Configuration copilot:* "set up routing for EMEA enterprise accounts" → proposed config + simulation.
   - *Cheap classifiers* trained on tenant-consented non-Slack data (cost/latency).
10. **Combining features into better workflows:**
   - **Incident flow:** anomaly detection → Problem → broadcast to affected Slack channels → link incident tool → close-the-loop notifications.
   - **Escalation-to-engineering flow:** issue → AI repro + similar issues → Linear/Jira ticket → auto Blocked status + follow-up SLA reminders → fix ships → customer notified.
   - **New-customer onboarding flow:** CRM deal closed → shared Slack channel created → welcome message + bookmarks → account tier SLA → CSM routing.

## Positioning hypothesis
"**The B2B support platform engineers trust and support teams love**": Pylon's B2B depth + Plain's developer platform + Front's collaboration UX + trustworthy, testable, affordable AI — without paywalls on the basics.

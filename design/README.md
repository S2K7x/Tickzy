# Tickzy UI design (v1 concept)

Live canvas: https://claude.ai/artifact/BvvyCE24er29B2iYNqLVxg (private until shared)

Visual direction: clean, card-based SaaS dashboard in the style of the supplied reference
(light grey canvas, white bordered cards, indigo accent with violet/blue/teal data colors),
applied to Tickzy's own product (B2B support), with light and dark themes.

Screens (`canvas/`, Design Component `.dc.html` source):
- `Main.dc.html` — Overview: open issues, first response, SLA compliance, AI resolutions, channel volume, SLA at risk, AI outcomes, accounts needing attention, product areas
- `Inbox.dc.html` — three-pane inbox: queue with views, conversation (Slack/email messages, internal notes, AI events), AI suggested reply with sources, reply/internal-note composer, account + SLA + properties + Linear link + similar issues
- `Agent.dc.html` — AI agent: live/shadow per queue, spend cap & model routing, backtest v15 vs v14, handoff rules, knowledge gaps
- `*Dark.dc.html` — the same screens in dark mode
- `Sidebar.dc.html`, `Topbar.dc.html` — shared components
- `StyleGuide.dc.html` — colors, theme tokens, type scale, components
- `Mobile*.dc.html` — 390 px phone screens (overview, inbox, issue) in light and dark; responsive rules in `docs/ux/ux-spec.md` §2.6

Tokens: see StyleGuide. Font: Inter (stand-in for SF Pro Display, which is not freely licensed for web).

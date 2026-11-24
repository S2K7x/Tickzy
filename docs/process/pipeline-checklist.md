# Pipeline Checklist — Tickzy (live status)

- **Last updated:** 2026-11-23 (T-207 search). Legend: ✅ done · 🟡 in progress / partial · ⬜ not started. Each item links to its evidence.
- Rules: update this file whenever an item changes status; an item is ✅ only with linked evidence (document, test, or deployment).
- Process definition: [`development-pipeline.md`](development-pipeline.md).

**Overall:** 22 ✅ · 12 🟡 · 22 ⬜ (of 56). **Current position:** Stage 5 (Build), M2 complete; threat model v1 written → T-110/T-112 then M3 (channels); Slack ToS legal review (founder) open, while Stage 1 user research/validation remains open on the discovery track.

## 01 · Discovery (3/6)
- ✅ Define the idea and problem — `docs/strategy/product-strategy.md` §1
- ✅ Market and competitor research — `docs/research/competitors/`, `docs/comparisons/`
- ⬜ User research (≥10 target-user interviews) — interview guide still to write (`docs/progress/next-research-tasks.md` #11)
- ✅ Define target audience — `product-strategy.md` §3 (hypothesis until interviews confirm)
- ⬜ Validate the opportunity (≥5 design-partner commitments)
- 🟡 Business & legal viability — pricing hypothesis `product-strategy.md` §9; **Slack API ToS legal review open**

## 02 · Product definition (6/6)
- ✅ Product vision & strategy — `docs/strategy/product-strategy.md`
- ✅ PRD — `docs/blueprint/requirements.md`
- ✅ MVP scope — `product-strategy.md` §7
- ✅ User stories and acceptance criteria — `requirements.md`
- ✅ Prioritized backlog — `docs/blueprint/backlog.md`
- ✅ Success metrics — `product-strategy.md` §12 (instrumentation pending, Stage 8)

## 03 · Design (4/5)
- ✅ User flows — `docs/ux/ux-spec.md` §4 (W1–W9)
- ✅ Wireframes / IA — `ux-spec.md` §1, design canvas
- ✅ UI/UX design (desktop + mobile, light + dark) — design system **v2** (2026-11-23, founder direction; `ux-spec.md` §2.0) implemented in the app; flows from the design canvas `design/canvas/` (its visuals are v1)
- 🟡 Interactive prototype — canvas prototype ✅; **usability test with users ⬜**
- ✅ Design system — `ux-spec.md` §2; tokens implemented in `apps/web/src/styles.css`

## 04 · Technical planning (5/7)
- 🟡 Feasibility study — research + cost estimate (`architecture.md` §11); **spikes S1–S7 ⬜** (`recommended-architecture.md` §4)
- ✅ Tech stack & system architecture — `docs/architecture/architecture.md`, `adr.md`
- ✅ Database schema and ERD — `docs/architecture/database.md`
- ✅ API specifications — `docs/blueprint/api-spec.md`
- ✅ Security & privacy planning — requirements SEC-1…14; **threat model v1** (`docs/security/threat-model.md`, STRIDE per component, 2026-11-24) with risk register TM-1…12; new tasks T-110 (security headers), T-111 (SSRF-guarded client), T-112 (CI scanning); security ACs added to M3/M5 tasks
- 🟡 Infrastructure, observability & cost plan — plan ✅; **SLO definitions ⬜**
- ✅ Test strategy — `requirements.md` (TEST-1…9), `adr.md` ADR-017

## 05 · Build (3/6)
- ✅ Repository and project setup — monorepo, CI file (`CURRENT-STATE.md`)
- 🟡 Implement frontend and backend — M0 ✅; M1 ✅ (auth, members, API tokens, rate limiting, sign-in/onboarding); **M2 ✅ 2026-11-24** (accounts/contacts, issues/messages, whose-turn, search, inbox, realtime + presence, filters/bulk/palette, accounts UI, saved views); M3 (channels) next
- 🟡 Implement database and integrations — migrations 0001–0012 with forced RLS and composite foreign keys ✅; migrations verified under a non-superuser owner; integrations from M3
- 🟡 Code reviews — automated gates + self-review in place; CI green on GitHub ✅ (run #1, 2026-11-23); **founder review of auth/access code pending**
- ✅ Documentation kept current — `CURRENT-STATE.md`, ADRs, checklists
- ✅ Feature flags / trunk-based workflow defined — `engineering-workflow.md` (flags implemented when first needed)

## 06 · QA & security (1/7)
- ✅ Unit and integration tests — 375 tests (shared 43 · db 25 · server 218 · web 89) incl. RLS isolation, auth security, members, API tokens, rate limits, issues, bulk, search, realtime, saved views
- 🟡 End-to-end testing — sign-in/onboarding (`apps/web/scripts/e2e-auth.cjs`, 18/18) two-user invite/members journey (`e2e-invite.cjs`, 23/23) API-token journey (`e2e-api-tokens.cjs`, 18/18) Google/Microsoft sign-in with a mock provider (`e2e-oauth.cjs`, 15/15) the inbox (`e2e-inbox.cjs`), the v2 Overview/shell (`e2e-overview.cjs`), realtime with two users (`e2e-realtime.cjs`), filters/bulk (`e2e-bulk.cjs`), palette + virtualised queue (`e2e-palette.cjs`), accounts (`e2e-accounts.cjs`) and saved views with two users (`e2e-views.cjs`) against the real stack ✅; not yet in CI (run each against a fresh server: back-to-back sign-ups trip the sign-in rate limit by design); support journeys from M3
- 🟡 Accessibility & responsive checks — signed-in shell 8/8 (390/768/1024/1280 × light/dark) + all auth pages + Members and API tokens (light/dark, 1280/390) + invite page + inbox (1280 light/dark, 390 queue/issue) + v2 Overview (1440 light/dark, 1024, 768, 390), 0 axe violations; repeat per new screen
- ⬜ AI evaluation sets & regression gates — from M5
- 🟡 Security testing — authz, tenant-isolation, token and rate-limit tests ✅ (server suites); security headers + strict CSP verified in a real browser (`e2e-csp.cjs`, T-110) ✅; secret scanning, dependency audit (high/critical fail) and SAST lint rules in CI (T-112, ADR-030) ✅; **ASVS L2 review, git-history secret scan, pentest ⬜**
- 🟡 Performance / load testing — search benchmark (`apps/server/scripts/bench-search.ts`, ADR-028) ✅; API load tests before design partners ⬜
- ⬜ User acceptance testing — design partners

## 07 · Release (0/6)
- ⬜ Environments: preview, staging, production
- 🟡 CI/CD — CI green on GitHub ✅; browser suites not yet in CI; **CD not set up**
- ⬜ Domain, TLS and secrets management
- ⬜ Migrations strategy in production and verified backups
- ⬜ Progressive delivery (flags, design-partner beta, rollback tested)
- ⬜ Production deployment

## 08 · Operations (0/7)
- ⬜ Monitoring, SLOs and alerting
- ⬜ Error tracking and logging (Sentry, OpenTelemetry) — structured logs exist in code
- ⬜ Incident response runbook and postmortem template
- ⬜ Security patching & dependency update routine
- ⬜ Backup and restore drills
- ⬜ Product & AI analytics instrumentation
- ⬜ Status page and customer communication

## 09 · Continuous improvement (0/5)
- ⬜ Collect user feedback (design partners, dogfooding)
- ⬜ Analyse product metrics, DORA and SLOs
- ⬜ Prioritise new features (backlog re-ranking each cycle)
- ⬜ Improve performance and UX from evidence
- ⬜ Repeat development and release cycles

## 10 · Retirement / replacement (n/a yet)
- ⬜ Deprecation policy and customer data export path defined (export also needed for GDPR — planned in database.md §4)

## Recommended next steps (in priority order)
1. M2 is complete (accounts/contacts/issues/messages APIs, whose-turn automation, search with a 1M-message benchmark within target, web inbox, realtime + presence, filters/bulk/palette, accounts UI, saved views). Register real Google/Microsoft OAuth apps before the first deployment (docs/operations/sign-in-providers.md).
2. In parallel on the discovery track: write the interview guide and start design-partner conversations (Stage 1 gate is still open; the MVP scope is a hypothesis until then).
3. Before M3 (channels): ~~written threat model~~ ✅ (`docs/security/threat-model.md`); ~~T-110 security headers~~ ✅; ~~T-112 CI scanning~~ ✅; next T-111 SSRF-guarded client (needed by T-303/T-504) and T-301 ingestion core; Slack ToS legal review (founder) before the Slack channel goes public.
4. Before first deploy: staging + preview environments, Sentry/OTel, SLO draft, backup/restore drill.

# Pipeline Checklist — Tickzy (live status)

- **Last updated:** 2026-11-23 (T-102). Legend: ✅ done · 🟡 in progress / partial · ⬜ not started. Each item links to its evidence.
- Rules: update this file whenever an item changes status; an item is ✅ only with linked evidence (document, test, or deployment).
- Process definition: [`development-pipeline.md`](development-pipeline.md).

**Overall:** 21 ✅ · 11 🟡 · 24 ⬜ (of 56). **Current position:** Stage 5 (Build), milestone M1, while Stage 1 user research/validation remains open on the discovery track.

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
- ✅ UI/UX design (desktop + mobile, light + dark) — design canvas, `design/canvas/`
- 🟡 Interactive prototype — canvas prototype ✅; **usability test with users ⬜**
- ✅ Design system — `ux-spec.md` §2; tokens implemented in `apps/web/src/styles.css`

## 04 · Technical planning (4/7)
- 🟡 Feasibility study — research + cost estimate (`architecture.md` §11); **spikes S1–S7 ⬜** (`recommended-architecture.md` §4)
- ✅ Tech stack & system architecture — `docs/architecture/architecture.md`, `adr.md`
- ✅ Database schema and ERD — `docs/architecture/database.md`
- ✅ API specifications — `docs/blueprint/api-spec.md`
- 🟡 Security & privacy planning — requirements SEC-1…14 ✅; **written threat model ⬜**
- 🟡 Infrastructure, observability & cost plan — plan ✅; **SLO definitions ⬜**
- ✅ Test strategy — `requirements.md` (TEST-1…9), `adr.md` ADR-017

## 05 · Build (3/6)
- ✅ Repository and project setup — monorepo, CI file (`CURRENT-STATE.md`)
- 🟡 Implement frontend and backend — M0 done; M1 in progress (T-101 auth core ✅, T-102 invitations & members ✅, T-104 ✅, T-105 web sign-in/onboarding ✅)
- 🟡 Implement database and integrations — migrations 0001–0004 with RLS ✅; integrations from M3
- 🟡 Code reviews — automated gates + self-review in place; **CI not yet observed green on GitHub**
- ✅ Documentation kept current — `CURRENT-STATE.md`, ADRs, checklists
- ✅ Feature flags / trunk-based workflow defined — `engineering-workflow.md` (flags implemented when first needed)

## 06 · QA & security (1/7)
- ✅ Unit and integration tests — 122 tests incl. RLS isolation, auth security and invitation/membership authorization suites
- 🟡 End-to-end testing — sign-in/onboarding (`apps/web/scripts/e2e-auth.cjs`, 18/18) and two-user invite/members journey (`e2e-invite.cjs`, 23/23) against the real stack ✅; not yet in CI; support journeys from M3
- 🟡 Accessibility & responsive checks — signed-in shell 8/8 (390/768/1024/1280 × light/dark) + all auth pages + Members (light/dark, 1280/390) + invite page, 0 axe violations; repeat per new screen
- ⬜ AI evaluation sets & regression gates — from M5
- ⬜ Security testing (SAST, dependency/secret scanning in CI, authz tests, ASVS L2, pentest)
- ⬜ Performance / load testing — before design partners
- ⬜ User acceptance testing — design partners

## 07 · Release (0/6)
- ⬜ Environments: preview, staging, production
- 🟡 CI/CD — CI workflow written; **CD not set up**
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
1. Finish M1 (T-103 API tokens, T-106 rate limiting, T-101b Google/Microsoft sign-in) — the delivery track.
2. In parallel on the discovery track: write the interview guide and start design-partner conversations (Stage 1 gate is still open; the MVP scope is a hypothesis until then).
3. Before M3 (channels): written threat model for ingestion/auth/AI, and the Slack ToS legal review.
4. Before first deploy: staging + preview environments, Sentry/OTel, SLO draft, backup/restore drill.

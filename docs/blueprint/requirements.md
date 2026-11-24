# Functional & Non-Functional Requirements (MVP → GA)

- **Date:** 2026-11-19 · Traceability: Strategy module (§6 of `docs/strategy/product-strategy.md`) → FR → tasks in `backlog.md` → `master-checklist.md`.
- Priority: **P0** = MVP must, **P1** = GA, **P2** = v2. Story format: *As a <persona>, I want … so that …*.

## FR-1 Workspace & identity (Module 1)
| ID | Requirement | Pri | Story | Acceptance criteria |
|---|---|---|---|---|
| FR-1.1 | Create workspace with name, slug, issue prefix | P0 | As a support lead I create a workspace so my team has a home | slug unique & URL-safe; prefix 2–5 uppercase letters; creator becomes admin; audit entry `workspace.created` |
| FR-1.2 | Sign in via magic link and Google/Microsoft OAuth | P0 | As an agent I sign in without a password | session cookie httpOnly/SameSite=Lax/secure; 30-day rolling; sign-out revokes session |
| FR-1.3 | Invite members with role (admin, agent, collaborator, viewer) | P0 | As an admin I invite teammates | invite email with expiring token (7d); accepting creates membership; collaborators and viewers unbilled |
| FR-1.4 | Permission checks on every endpoint | P0 | — | permission matrix in `api-spec.md §2`; 403 with code `forbidden`; tests per role |
| FR-1.5 | Tenant isolation | P0 | As a customer I trust my data is isolated | RLS on every tenant table; isolation test suite proves no cross-workspace read/write |
| FR-1.6 | API tokens (scoped, shown once) | P0 | As a developer I automate Tickzy | token hashed at rest; prefix visible; revocable; last_used_at updated |
| FR-1.7 | Audit log | P0 | As an admin I see who changed settings | append-only; filter by actor/action/date; export CSV (P1) |
| FR-1.8 | SAML SSO; SCIM | P1/P2 | | WorkOS connection per workspace; enforced SSO option |

## FR-2 Channels (Module 2)
| FR-2.1 | Slack OAuth install; list channels; mark endpoints customer/community/internal/triage | P0 | As an admin I connect our Slack | bot token encrypted; channel picker supports bulk; `/invite @Tickzy` path supported |
| FR-2.2 | Ingest Slack messages via Events API (signed, ack <1s, deduped) | P0 | | signature + 5-min timestamp check; duplicate event ids ignored; p95 visible in inbox < 5s |
| FR-2.3 | Ingestion modes per endpoint: time (2h same user/1h others), thread (1:1), emoji, ai | P0 (ai P1) | As an agent I don't want one issue per message | rules exactly as Plain spec; reply in thread always attaches to existing issue |
| FR-2.4 | Reply to Slack from Tickzy as bot (custom name/icon) or as user (user token) | P0 | | reply lands in the correct thread; failures visible with retry |
| FR-2.5 | Internal triage thread per new issue in a configured internal channel; replies sync as internal notes | P0 | | each issue ≤1 auto-thread; edits sync |
| FR-2.6 | Emoji actions (✅ resolve, 👀 take) from Slack | P1 | | |
| FR-2.7 | Email inbound via forwarding address; outbound via verified domain | P0 | As an agent I answer email in the same inbox | threading by Message-ID/References/reply token; quoted text stripped; inline images preserved; auto-replies flagged & not reopening issues |
| FR-2.8 | Chat widget with identity verification (HMAC) | P0 | As an end-user I chat from the product | unsigned identities treated as anonymous; offline → email fallback |
| FR-2.9 | Message edits/deletes propagate | P1 | | |
| FR-2.10 | MS Teams, Discord, portal | P2/P1 | | per channel adapter contract |

## FR-3 Inbox & issues (Module 3)
| FR-3.1 | Issue lifecycle with status categories (triage, waiting_on_us, waiting_on_customer, blocked, resolved, closed, ignored) + custom statuses | P0 | | customer message on resolved → waiting_on_us (reopen); on closed → new issue; ignored never notifies or counts in metrics |
| FR-3.2 | Automatic whose-turn: last public message author decides waiting_on_us/waiting_on_customer (AI override for acknowledgements P1) | P0 | As an agent I never update status by hand for normal back-and-forth | transitions logged as system events with reason |
| FR-3.3 | Priority, labels, custom fields, product area | P0 | | |
| FR-3.4 | Assignment: manual, team round-robin | P0 | | assignment event + notification |
| FR-3.5 | Internal notes with @mentions | P0 | | mention notifies; never sent to customer (tests) |
| FR-3.6 | Merge and split | P1 | | |
| FR-3.7 | Views: system views + saved views with filters/sort | P0 | | URL reflects view; counts update realtime |
| FR-3.8 | Search: full-text across issues/messages/accounts with operators (`from:`, `account:`, `status:`, `is:`, `channel:`) | P0 | As an agent I find past threads fast | p95 < 300 ms on 1M messages (benchmark) |
| FR-3.9 | Realtime updates & collision presence | P0 | | other viewers shown; updates < 1s |
| FR-3.10 | Bulk actions | P1 | | |
| FR-3.11 | Keyboard shortcuts & command palette | P0 | | full list in UX spec §2.5 |

## FR-4 Accounts & contacts (Module 4)
| FR-4.1 | Accounts with domain(s), tier, owner, external ids, custom fields | P0 | | |
| FR-4.2 | Contact identity graph and auto-mapping (email domain, Slack team, endpoint default account) | P0 | | manual override audited |
| FR-4.3 | Account profile with issues, contacts, channels, activity | P0 | | |
| FR-4.4 | Signals: champion left, volume spike, sentiment trend | P2 | | |

## FR-5 SLA & routing (Module 5)
| FR-5.1 | Business schedules (timezone, weekly hours, holidays) | P0 | | |
| FR-5.2 | SLA policies with conditions (priority, tier, channel, account) and targets (first response, next response, follow-up, resolution) | P0 | | first matching policy by order; preview on recent issues |
| FR-5.3 | Timer semantics per ADR-011 | P0 | | property-based tests for schedule math |
| FR-5.4 | Warnings & breaches → in-app + Slack + email notifications; "Breaching" view | P0 | | warning emitted once |
| FR-5.5 | Skills, capacity, pull queues | P2 | | |

## FR-6 Workflows (Module 6) — P1
Event triggers, conditions incl. AI condition, actions, waits, versioning, dry-run, loop guard (architecture §8). MVP: built-in automations (auto-assign by team, auto-close resolved after 7d, SLA alerts) — P0.

## FR-7 AI (Module 7)
| FR-7.1 | AI triage on issue creation: title, priority (rubric, never overrides human), labels (≤2, AI-enabled labels only), product area | P0 | | each result logged in `ai_actions` with model, tokens, cost |
| FR-7.2 | Thread summary ("catch up") on demand and on long threads | P0 | | |
| FR-7.3 | Draft reply with citations from knowledge + resolved issues; confidence; use/edit/regenerate | P0 | As an agent I answer faster with trustworthy drafts | every claim cites a source; internal-only sources never appear in customer text; acceptance tracked |
| FR-7.4 | Similar issues | P0 | | top 3 with score threshold |
| FR-7.5 | AI log tab per issue | P0 | | |
| FR-7.6 | Spend cap & per-feature toggles; AI fully disable-able | P0 | | cap reached → features degrade gracefully |
| FR-7.7 | Customer-facing agent: shadow mode (P0), live per queue (P1), handoff policy, budgets, approvals | P0/P1 | | |
| FR-7.8 | Backtests with QA rubric grading | P1 | | |
| FR-7.9 | Knowledge gaps → draft article | P1 | | |
| FR-7.10 | BYO LLM key; investigative copilot with MCP connectors | P2 | | |

## FR-8 Knowledge (Module 8)
| FR-8.1 | Sources: URL crawl (sitemap), manual articles, resolved-issue history (opt-in, excludes internal notes unless internal visibility) | P0 | | sync status & errors visible |
| FR-8.2 | Hybrid retrieval (FTS + vector + rerank) with visibility filter | P0 | | retrieval eval set ≥ recall@5 0.8 on seed corpus |
| FR-8.3 | Public help center | P1 | | |

## FR-9 Engineering loop & problems (Module 9)
| FR-9.1 | Linear & Jira: connect, create issue from Tickzy (AI-prefilled), link existing, status sync webhook | P0 | | linked open ticket → issue Blocked; ticket done → issue waiting_on_us + "close the loop" prompt |
| FR-9.2 | Problems grouping issues + broadcast on fix | P1 | | |

## FR-10 Analytics (Module 10)
| FR-10.1 | Overview metrics (open, FRT, resolution time, SLA compliance, AI resolution rate, volume by channel) with definitions | P0 | | numbers reproducible from raw data via documented SQL |
| FR-10.2 | Team, SLA, AI, product-area dashboards | P1 | | |

## FR-11 Developer platform (Module 11)
| FR-11.1 | REST API v1 with OpenAPI 3.1 published | P0 | | UI uses only these endpoints |
| FR-11.2 | Webhooks: typed events, HMAC signatures, retries ≥24h exp. backoff, delivery log, replay | P0 | | |
| FR-11.3 | MCP server; context cards; TS SDK | P1 | | |

## FR-12 Billing (Module 12) — P1
Plans, seats (collaborators free), AI usage metering & caps, Stripe.

---
## Non-functional requirements
| ID | Requirement |
|---|---|
| NFR-1 Performance | API read p95 <150 ms; Slack→inbox p95 <5 s; inbox interactions <100 ms perceived (optimistic) |
| NFR-2 Reliability | No inbound message loss (persist before ack); at-least-once processing with idempotency; 99.9% monthly uptime target post-GA |
| NFR-3 Security | OWASP ASVS L2 baseline; RLS; encrypted secrets; signed webhooks; SSRF guard; rate limits per token & IP; dependency scanning; secrets never logged |
| NFR-4 Privacy | GDPR: DPA, data export, erasure ≤30 days; Slack data provenance & no training; EU region at GA |
| NFR-5 Accessibility | WCAG 2.2 AA; keyboard complete; both themes contrast-checked |
| NFR-6 Responsiveness | Fully usable at 390px width for triage/reply/assign; desktop ≥1280 three-pane |
| NFR-7 Observability | Structured logs, traces, error tracking, SLO dashboards |
| NFR-8 Maintainability | TypeScript strict; module boundaries linted; ≥80% coverage on domain logic (SLA, segmentation, permissions); ADR for every architectural change |

## Security requirements (checklist)
SEC-1 Auth cookies secure/httpOnly/SameSite · SEC-2 CSRF protection for cookie-auth mutating requests (Origin check + SameSite) · SEC-3 RLS + isolation tests · SEC-4 Input validation with zod on every route · SEC-5 Output encoding; HTML sanitisation of email bodies (server-side allowlist) · SEC-6 Envelope-encrypted provider tokens · SEC-7 Webhook signature verification (Slack, Postmark, Linear, Jira) · SEC-8 Outbound SSRF guard · SEC-9 Rate limiting · SEC-10 Audit log for admin actions · SEC-11 Prompt-injection defences (customer content never in instruction position; tool policy checks outside the model) · SEC-12 Secrets via env/secret manager only · SEC-13 Dependency & container scanning in CI · SEC-14 Attachments served from separate domain with content-disposition. Threats, controls per component and the risk register: `docs/security/threat-model.md`.

## Testing requirements
TEST-1 Unit tests for pure domain logic · TEST-2 Integration tests against real Postgres for every repository/route · TEST-3 RLS isolation suite per tenant table · TEST-4 Provider fakes (Slack, Postmark, LLM, Linear) with recorded fixtures · TEST-5 Contract tests: OpenAPI schema validated against responses · TEST-6 E2E (Playwright) for W1–W5 from M3 · TEST-7 Load test ingestion (k6) before design partners · TEST-8 Accessibility checks (axe) on core screens · TEST-9 CI blocks merge on failure.

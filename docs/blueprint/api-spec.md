# API Specification — REST v1 (MVP surface)

- Base: `https://api.tickzy.app/v1` (dev `http://localhost:3000/v1`). JSON only. OpenAPI 3.1 generated from zod schemas at `/v1/openapi.json`.
- **Auth:** session cookie (web app) or `Authorization: Bearer tkz_live_…` (API token). Workspace resolved from token or header `Tickzy-Workspace: ws_…` (session users with several workspaces).
- **Versioning:** `Tickzy-Version: 2027-01-01` (default = token's pinned version).
- **Conventions:** IDs prefixed ULIDs; timestamps RFC 3339 UTC; list endpoints `?limit=1..100&cursor=` → `{data:[…], next_cursor}`; `Idempotency-Key` honored on POST for 24h; partial updates via PATCH with explicit nulls; error envelope:
```json
{ "error": { "code": "validation_failed", "message": "…", "details": [{"path":"title","issue":"too_long"}], "request_id": "req_…" } }
```
Codes: `unauthenticated` 401, `forbidden` 403, `not_found` 404, `validation_failed` 422, `conflict` 409, `rate_limited` 429, `internal` 500. Rate limit headers `RateLimit-Limit/Remaining/Reset` on every response; 429 adds `Retry-After`. Defaults (ADR-023): 600 req/min per API token or user, 1200 req/min per client IP, 20 req/min per IP on sign-in and invitation endpoints.

## 1. Endpoints
| Method & path | Purpose | Permission | Milestone |
|---|---|---|---|
| GET `/healthz`, `/readyz` | liveness / readiness | public | M0 |
| POST `/v1/workspaces` | create workspace (caller becomes admin) | authenticated user | M0 |
| GET `/v1/workspaces/current` | current workspace | member | M0 |
| PATCH `/v1/workspaces/current` | update name/prefix | `workspace:manage` | M0 |
| GET `/v1/auth/providers` → `{providers: ("google"\|"microsoft")[]}` · GET `/v1/auth/oauth/{provider}/start?return_to=/path` (302 to provider) · GET `/v1/auth/oauth/{provider}/callback` (302 to app; errors → `/sign-in?error=email_unverified\|cancelled\|provider_disabled\|provider_unavailable\|oauth_failed`) | Google/Microsoft sign-in (ADR-024) | public | M1 ✅ |
| GET `/v1/members` · PATCH/DELETE `/v1/members/{id}` (role, status; last-active-admin guard → 409) | members | `members:manage` (list: member) | M1 ✅ |
| GET/POST `/v1/invitations` (re-inviting a pending email rotates the token) · DELETE `/v1/invitations/{id}` (revoke) | invitations | `members:manage` | M1 ✅ |
| POST `/v1/invitations/preview` `{token}` · POST `/v1/invitations/accept` `{token}` | invite landing page: preview is public (token = capability); accept requires sign-in with the invited email (403 otherwise, 404 when invalid/used/revoked/expired) | public · authenticated user | M1 ✅ |
| GET/POST `/v1/api-tokens` (`{name, scopes[], expires_in_days: 30\|90\|365\|null}`; token returned once) · DELETE `/v1/api-tokens/{id}` | tokens (ADR-022; scopes = permissions minus `developers:manage`) | `developers:manage` (session only — tokens cannot manage tokens) | M1 ✅ |
| GET `/v1/audit-log` | audit | `audit:read` | M0/M1 |
| GET/POST `/v1/accounts` (each account includes `contact_count`, `open_issue_count`, `last_activity_at`; `q` = name or domain prefix; keyset `cursor`, `limit` ≤100) · GET/PATCH/DELETE `/v1/accounts/{id}` | accounts: `{name, domains[], tier, owner_membership_id, external_ids, custom}` + `contact_count`, `open_issue_count`. Public email domains refused (422), a domain belongs to one account (409); adding a domain attaches unassigned automatic contacts; DELETE is soft and releases domains | read: member or any token; write: `accounts:write` | M2 ✅ |
| GET/POST `/v1/contacts` (`account_id`, `q`, keyset) · GET/PATCH/DELETE `/v1/contacts/{id}` · POST `/v1/contacts/{id}/identities` · DELETE `/v1/contacts/{id}/identities/{identityId}` | contacts + identity graph (FR-4.2): `email` on create auto-maps the account from its company domain; `account_id` on create/PATCH is a **manual** choice (audited, never changed automatically); `auto_account: true` hands back to auto-mapping | same | M2 ✅ |
| GET `/v1/issues` — filters (comma lists allowed): `status` (categories), `status_id`, `assignee` (membership id \| `me` \| `none`), `team`, `account`, `priority`, `channel`, `label`, `q` (title text or key `ACME-12`); `sort` = `updated` (default) \| `newest` \| `oldest` \| `priority`; keyset `cursor`, `limit` ≤100. SLA-due sort arrives with the SLA engine | list | `issues:read` | M2 ✅ |
| GET `/v1/issues/stats` → `{counts: {open, waiting_on_us, waiting_on_customer, mine\|null, unassigned, done}, kpis: {new_today, new_yesterday, waiting_on_us, avg_wait_seconds, waiting_on_customer, resolved_7d, resolved_prev_7d, median_first_response_seconds_7d}, series: [{day, created, resolved, first_responses, customer_messages, team_replies}] × 14}` — real counts for dashboards and tab counts (UTC days; ignored issues excluded) | stats | `issues:read` | M2 ✅ |
| POST `/v1/issues` — `{title, priority?, category?, assignee_membership_id?, team_id?, account_id?, requester_contact_id?, product_area?, labels?: id[], custom?}`; channel = `ui` (user) or `api` (token) | create | `issues:write` | M2 ✅ |
| GET/PATCH `/v1/issues/{id \| key \| number}` — PATCH also takes `status` (category) or `status_id`, and optional `version` (409 if changed meanwhile); assignee must be able to work issues (admin/agent); every change appends a timeline event | read / update | read: `issues:read`; write: `issues:write` | M2 ✅ |
| POST `/v1/issues/bulk` — `{issues: ref[] (1–100), changes: {status? \| status_id?, priority?, assignee_membership_id?, team_id?, add_labels?, remove_labels?}}` → `{results: ({ref, ok:true, issue} \| {ref, ok:false, error:{code,message}})[]}`. Each issue is applied in its own savepoint (one refusal — e.g. a closed issue — does not undo the others); invalid references fail the whole request with 422; already-in-target is a no-op | bulk actions (FR-3.10) | `issues:write` | M2 ✅ |
| GET `/v1/labels` → `{data: {id, name, color, description, parent_id}[]}` (active, by name) · POST `/v1/labels` `{name, color?, description?}` → 201; 409 if the name exists (case-insensitive); colour defaults from the name. Creating labels needs only `issues:write` so agents can label while triaging; rename/archive will be in Settings (`settings:manage`) | labels | read: `issues:read` · create: `issues:write` | M2 ✅ |
| GET `/v1/teams` → `{data: {id, name}[]}` (active, by name). Team management arrives with routing (T-404) | teams | `issues:read` | M2 ✅ |
| GET `/v1/issues/{ref}/timeline` → `{data: ({kind:"message", message: {…, author:{type,id,name}}} \| {kind:"event", event})[], truncated}` chronological (capped at 1000) | messages + events | `issues:read` | M2 ✅ |
| POST `/v1/issues/{ref}/messages` `{body, visibility}` → Message (201). Reply goes into the issue's latest conversation; queued (`delivery_state: pending`) only when that channel has a delivery adapter; internal notes are never queued · POST `/v1/messages/{id}/retry` re-queues a `failed` public message (FR-2.4) | reply (`visibility: public`) or note (`internal`) | public: `issues:reply`; internal: `issues:note`; retry: `issues:reply` | M2 ✅ |
| POST `/v1/issues/{id}/merge` · `/split` | merge/split | `issues:write` | M4 |
| GET `/v1/search?q=&limit≤50` → `{query:{text, filters}, issues:[{issue, match:{in: title\|message\|filters, message_id, snippet}}], accounts:[{id,name,domains}]}`. Operators: `from:` `account:` `status:` `is:open\|unassigned\|mine\|internal` `channel:` `priority:`; "phrases", `-word`. Snippet highlights are wrapped in U+0001 … U+0002 (render as `<mark>`, never HTML) | global search (ADR-028) | `issues:read` | M2 ✅ |
| GET/POST `/v1/views` · GET/PATCH/DELETE `/v1/views/{id}` — view = `{name, shared, base (system view: open, on-us, on-customer, mine, unassigned, done), filters: {priority?, channel?, team?, label?, account?, q?} (comma lists, validated like GET /v1/issues), sort, position}`; responses add `count` (matching issues, same rules as the list), `owner_name`, `can_edit`. Personal views are private (RLS); `shared: true` needs `issues:write`; changes by owner or admin (shared ones audited + announced over realtime); names unique (409); 50 personal / 100 shared; API tokens 403 | saved views (FR-3.7) | member (user sessions only) | M2 ✅ |
| GET/POST/PATCH `/v1/channels/*` | Slack/email/widget connections & endpoints | `channels:manage` | M3 |
| POST `/ingest/slack/events` · `/ingest/slack/interactions` · `/ingest/email/postmark` · `/ingest/linear` · `/ingest/jira` | provider webhooks (signature-verified, not /v1) | provider signature | M3/M6 |
| GET/POST/PATCH `/v1/sla/policies`, `/v1/business-schedules` | SLA config | `settings:manage` | M4 |
| POST `/v1/sla/policies/{id}/preview` | preview on recent issues | `settings:manage` | M4 |
| GET `/v1/analytics/overview?from&to&channel` | metrics | member | M4 |
| POST `/v1/issues/{id}/ai/draft` · `/ai/summary` · GET `/ai/similar` | AI copilot | `issues:reply` | M5 |
| GET `/v1/issues/{id}/ai-actions` | AI log | `issues:read` | M5 |
| PATCH `/v1/ai/settings` | toggles, spend cap | `ai:manage` | M5 |
| GET/POST `/v1/knowledge/sources` · POST `/{id}/sync` · GET `/v1/knowledge/search` | knowledge | `knowledge:manage` | M5 |
| POST `/v1/issues/{id}/links` (create or link Linear/Jira) · DELETE | engineering links | `issues:write` | M6 |
| GET/POST/PATCH/DELETE `/v1/webhooks` · GET `/v1/webhooks/{id}/deliveries` · POST `/deliveries/{id}/replay` | webhooks | `developers:manage` | M6 |
| WS `/v1/realtime` ✅ | signed-in users (session cookie, Origin allow-list). Client → `{op:'sub'\|'unsub', topic}` (`workspace:{id}:inbox`, `issue:{id}`), `{op:'presence', issue_id, state:'viewing'\|'typing'\|'left'}` (after `subscribed`), `{op:'ping'}`. Server → `ready`, `subscribed`, `error {error}`, `event {topic, type, issue_id, message_id}` (ids only — refetch via REST), `presence {issue_id, viewers[]}`, `pong`. Messages handled in order; limits 50 subs, 4 KB/msg, 20 msg/s | per-topic auth (active member; issue visible under RLS) | M2 |

## 2. Permission matrix
| Permission | admin | agent | collaborator | viewer | integration token |
|---|---|---|---|---|---|
| workspace:manage, members:manage, settings:manage, channels:manage, developers:manage, ai:manage, audit:read | ✅ | — | — | — | scoped |
| issues:read | ✅ | ✅ | ✅ | ✅ | scoped |
| issues:write, issues:reply | ✅ | ✅ | — | — | scoped |
| issues:note | ✅ | ✅ | ✅ | ✅ | scoped |
| accounts:write | ✅ | ✅ | — | — | scoped |
| knowledge:manage | ✅ | ✅ | — | — | scoped |

## 3. Core resource shapes (abridged)
```ts
Workspace { id: 'ws_…', name, slug, issue_prefix, region: 'us'|'eu', created_at }
Issue { id:'iss_…', key:'TKZ-42', number, title, status:{category, id, name}, priority, assignee:{membership_id,user_id,name,email}|null, team_id|null, account:{id,name,tier}|null, requester:{id,name}|null, channel, product_area|null, labels:{id,name,color}[], fields:Record<string,unknown>, sla:{metric,state,due_at}[] (empty until the SLA engine, M3/M4), first_response_at, resolved_at, created_at, updated_at, version }
Message { id:'msg_…', issue_id, visibility:'public'|'internal', direction:'in'|'out', author:{type,id,name}, body:{text, ast}, source, delivery_state, attachments:[], created_at }
```

## 4. Webhook events (outbound, typed)
`issue.created`, `issue.updated` (with `changes`), `issue.status_changed`, `issue.assigned`, `message.created`, `sla.warning`, `sla.breached`, `account.created`, `link.status_changed`, `ai.draft_created`. Envelope: `{id:'evt_…', type, created_at, workspace_id, api_version, data:{…}}`. Header `Tickzy-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + '.' + body)>`. Retries: 1m, 5m, 30m, 2h, 6h, 12h, 24h; auto-disable after 3 days failing.

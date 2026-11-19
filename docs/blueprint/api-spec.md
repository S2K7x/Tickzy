# API Specification — REST v1 (MVP surface)

- Base: `https://api.tickzy.app/v1` (dev `http://localhost:3000/v1`). JSON only. OpenAPI 3.1 generated from zod schemas at `/v1/openapi.json`.
- **Auth:** session cookie (web app) or `Authorization: Bearer tkz_live_…` (API token). Workspace resolved from token or header `Tickzy-Workspace: ws_…` (session users with several workspaces).
- **Versioning:** `Tickzy-Version: 2027-01-01` (default = token's pinned version).
- **Conventions:** IDs prefixed ULIDs; timestamps RFC 3339 UTC; list endpoints `?limit=1..100&cursor=` → `{data:[…], next_cursor}`; `Idempotency-Key` honored on POST for 24h; partial updates via PATCH with explicit nulls; error envelope:
```json
{ "error": { "code": "validation_failed", "message": "…", "details": [{"path":"title","issue":"too_long"}], "request_id": "req_…" } }
```
Codes: `unauthenticated` 401, `forbidden` 403, `not_found` 404, `validation_failed` 422, `conflict` 409, `rate_limited` 429, `internal` 500. Rate limit headers `RateLimit-Limit/Remaining/Reset`; default 600 req/min per token.

## 1. Endpoints
| Method & path | Purpose | Permission | Milestone |
|---|---|---|---|
| GET `/healthz`, `/readyz` | liveness / readiness | public | M0 |
| POST `/v1/workspaces` | create workspace (caller becomes admin) | authenticated user | M0 |
| GET `/v1/workspaces/current` | current workspace | member | M0 |
| PATCH `/v1/workspaces/current` | update name/prefix | `workspace:manage` | M0 |
| GET `/v1/members` · POST `/v1/invitations` · PATCH/DELETE `/v1/members/{id}` | members | `members:manage` (list: member) | M1 |
| GET/POST `/v1/api-tokens` · DELETE `/v1/api-tokens/{id}` | tokens | `developers:manage` | M1 |
| GET `/v1/audit-log` | audit | `audit:read` | M0/M1 |
| GET/POST `/v1/accounts` · GET/PATCH/DELETE `/v1/accounts/{id}` | accounts | read: member; write: `accounts:write` | M2 |
| GET/POST `/v1/contacts` · GET/PATCH `/v1/contacts/{id}` | contacts | same | M2 |
| GET `/v1/issues` (filters: status, assignee, team, account, priority, channel, label, q, sort) | list | `issues:read` | M2 |
| POST `/v1/issues` | create (API/manual) | `issues:write` | M2 |
| GET/PATCH `/v1/issues/{id or key}` | read/update status, priority, assignee, team, labels, fields | `issues:write` | M2 |
| GET `/v1/issues/{id}/timeline` | messages + events | `issues:read` | M2 |
| POST `/v1/issues/{id}/messages` | reply (`visibility: public`) or note (`internal`) | public: `issues:reply`; internal: `issues:note` | M2 |
| POST `/v1/issues/{id}/merge` · `/split` | merge/split | `issues:write` | M4 |
| GET `/v1/search?q=` | global search | `issues:read` | M2 |
| GET/POST `/v1/views` | saved views | member | M2 |
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
| WS `/v1/realtime` | subscribe `{op:'sub', topic}` | per-topic auth | M2 |

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
Issue { id:'iss_…', key:'TKZ-42', number, title, status:{category, id, name}, priority, assignee?:Principal, team_id?, account?:{id,name,tier}, requester?:{id,name}, channel, product_area?, labels:string[], fields:Record<string,unknown>, sla:{metric,state,due_at}[], created_at, updated_at, version }
Message { id:'msg_…', issue_id, visibility:'public'|'internal', direction:'in'|'out', author:{type,id,name}, body:{text, ast}, source, delivery_state, attachments:[], created_at }
```

## 4. Webhook events (outbound, typed)
`issue.created`, `issue.updated` (with `changes`), `issue.status_changed`, `issue.assigned`, `message.created`, `sla.warning`, `sla.breached`, `account.created`, `link.status_changed`, `ai.draft_created`. Envelope: `{id:'evt_…', type, created_at, workspace_id, api_version, data:{…}}`. Header `Tickzy-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + '.' + body)>`. Retries: 1m, 5m, 30m, 2h, 6h, 12h, 24h; auto-disable after 3 days failing.

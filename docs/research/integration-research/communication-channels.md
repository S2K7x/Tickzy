# Communication Channel Integration Research (Slack, Teams, Email, Discord, Chat, Messaging)

- **Research date:** 2026-11-19 · **Missions:** M14 (communication architecture), M20 (integration ecosystem)
- **Primary sources:** [Slack rate-limit change for non-Marketplace apps](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps), [Slack API Terms of Service](https://slack.com/terms-of-service/api), [Slack changelog (Connect/ToS 2025)](https://api.slack.com/changelog/slack-connect-api-2025), [Slack rate limits](https://docs.slack.dev/apis/web-api/rate-limits), [MS Graph change notifications overview](https://learn.microsoft.com/en-us/graph/api/resources/change-notifications-api-overview), [Teams apps in shared/private channels](https://learn.microsoft.com/en-ie/MicrosoftTeams/platform/build-apps-for-shared-private-channels), [MS Q&A on shared-channel notifications](https://learn.microsoft.com/en-us/answers/a/12690755), [Tech Community thread](https://techcommunity.microsoft.com/discussions/teamsdeveloper/bot-not-receiving-message-events-in-shared-channels-rsc/4506262); competitor docs (Pylon, Plain) cited in competitor dossiers.
- **Evidence levels** are noted per claim. Items marked *(K)* are from established platform knowledge not re-fetched in this session → treat as PARTIALLY VERIFIED until re-checked during implementation.

---

## 1. Slack — the most important and most constrained channel

### 1.1 Platform constraints (VERIFIED, 2025–2026 changes — **critical for Tickzy**)
| Constraint | Detail | Impact |
|---|---|---|
| **Commercial distribution only via Slack Marketplace** | ToS: any app where users could pay (incl. freemium) must be authorised, normally by Marketplace listing + Marketplace Agreement | Tickzy *must* be a Marketplace app |
| **Marketplace review requires ≥10 active workspace installs** | Changelog note | Chicken-and-egg: need ~10 design-partner installs while unlisted |
| **Unlisted apps: `conversations.history` and `conversations.replies` limited to 1 req/min, max 15 objects** (from 2025-05-29 for new apps/installs; existing unlisted installs migrated 2026-03-03 per secondary sources) | Marketplace apps & internal custom apps unaffected (custom apps 50+/min, 1,000 objects) | Historical backfill is ~impossible pre-Marketplace → **design live ingestion around the Events API**, backfill lazily, and prioritise Marketplace approval in the roadmap |
| **No LLM training on API Data** | "(A) use API Data to train a large language model" prohibited | Fine-tuning on Slack-sourced conversations is forbidden → data provenance tagging required; any model training pipeline must exclude Slack-sourced content |
| **No bulk export** of message/file data (except Discovery API under agreement) | (B) | Warehouse sync/export features must be scoped carefully for Slack-sourced data (export *the customer's own* support records — legal review needed) |
| **No cross-organisation benefit** | "(C) use data collected from one organization to directly benefit a different organization" | Cross-tenant learning (shared embeddings/"network effect" models) using Slack data is prohibited → strict per-tenant AI isolation |
| **Minimise retention**; explicit authorisation from installing org for use/processing/storage | ToS | Consent screens, retention settings, deletion on uninstall |
| Data Access API / Real-Time Search API: no persistent copies/indexes of other orgs' data | ToS | Do not use these APIs as an ingestion route; ingest via Events API under normal app scopes |

**Open legal question (UNVERIFIED):** how competitors (Pylon, Plain, ClearFeed) reconcile persistent ticket storage + AI with these terms. Most likely: storing messages *as the app's core functionality, with explicit consent* is "minimum necessary to operate"; RAG over the tenant's own data is not "training". Plain documents a "Slack data retention" page ([docs index](https://www.plain.com/docs/llms.txt)). → **Action: legal review before launch** (tracked in `docs/progress/next-research-tasks.md`).

### 1.2 Architecture for Slack (recommended)
- **Ingestion:** Events API over HTTPS (not Socket Mode, which Marketplace apps can't rely on *(K)*): `message.channels`, `message.groups`, `message.im`, `message.mpim`, `reaction_added/removed`, `member_joined_channel`/`member_left_channel` (Pylon's "champion left" alert), `channel_shared`/`channel_unshared`, `app_mention`, `file_shared`, `message_changed`/`message_deleted` subtypes *(K)*.
- **Acknowledge in <3 s** and process asynchronously (Slack retries up to 3× with `X-Slack-Retry-Num`) → webhook ingestion service writes raw event to a durable inbox table/queue, dedupes on `event_id`, returns 200 *(K)*.
- **Shared channels (Slack Connect):** the app is installed in the *vendor's* workspace; customers in the shared channel are external users (user IDs from another team; `users.info` may be restricted; use `team_id`/`user_team` fields) *(K)*. Requesters in shared channels **cannot use the app's slash commands/shortcuts** (Halp docs) → intake affordances for customers are: plain messages, emoji reactions, Block Kit buttons posted by the bot (buttons do work for external users *(K)* — verify), and links to portal/forms.
- **Outbound:** `chat.postMessage` as the bot (optionally `chat:write.customize` for per-agent name/icon) **or as the agent via user token** (Thena's "Slack authorization" — reply as yourself). Must handle `thread_ts` to keep replies threaded; respect Tier-based rate limits (≈1 msg/sec/channel for chat.postMessage *(K)*).
- **Conversation segmentation:** implement Plain's four modes (time-based, AI-based, 1:1 thread, emoji) + AI matching to open issues (Pylon's conversation view) — see `docs/research/feature-analysis/ticketing-functionality.md`.
- **Internal threads:** post an issue card into an internal triage channel and sync the thread's replies back as internal notes (Pylon/ClearFeed pattern).
- **Identity mapping:** Slack user (team_id+user_id) → contact; Slack team → account (with manual override); email from profile when available.
- **Files:** download via `url_private` with bot token, store in object storage, virus-scan, re-host for agent UI.
- **Edits/deletes:** propagate edits and deletions both ways; Pylon has trigger events for message edited/deleted.

## 2. Microsoft Teams — second-most-important B2B chat channel, technically harder

### 2.1 Constraints
- Teams apps (bots + tabs) are **supported in shared and private channels**, and can get **membership change notifications** via Graph (VERIFIED — [MS Learn](https://learn.microsoft.com/en-ie/MicrosoftTeams/platform/build-apps-for-shared-private-channels)).
- **Message change notifications for shared/private channels via RSC appear blocked**; community answers recommend **polling with delta queries** (~60s) — PARTIALLY VERIFIED (Microsoft Q&A + Tech Community, Mar 2026; not official docs) ([Q&A](https://learn.microsoft.com/en-us/answers/a/12690755), [thread](https://techcommunity.microsoft.com/discussions/teamsdeveloper/bot-not-receiving-message-events-in-shared-channels-rsc/4506262)).
- Graph subscription cap: **10,000 Teams change-notification subscriptions per tenant org, shared across apps** (VERIFIED — [overview](https://learn.microsoft.com/en-us/graph/api/resources/change-notifications-api-overview)). Subscriptions expire and must be renewed (max lifetime ~1h for chat messages with resource data *(K)*); rich notifications require encryption certificates *(K)*.
- Bot Framework throttling ~50 rps global / ~1,800 ops/hour/thread — UNVERIFIED (forum).
- Protected APIs (e.g., `getAllMessages`) require Microsoft approval and may be metered *(K)*.
- Teams chats (1:1 / group) are continuous → need AI segmentation (Pylon "issue conversation view").
- External collaboration: shared channels via **B2B direct connect** require cross-tenant access settings on both tenants *(K)*.

### 2.2 Recommendation
Build Teams on the same **channel-adapter interface** as Slack, but with a hybrid **bot-receive + Graph delta polling** strategy, per-tenant subscription budget management, and explicit admin-consent onboarding. Pylon and Plain gate Teams to upper tiers, partly reflecting this engineering cost — Tickzy offering Teams on all plans is a differentiator but should come after Slack + email are excellent (roadmap Phase 2).

## 3. Email — must be first-class (competitor weakness)

Complaints about email threading/images in Pylon and formatting in Plain (see `customer-feedback/review-analysis.md`) show chat-first vendors under-invest in email.

### 3.1 Inbound
- **Forwarding model** (support@customer.com → `<workspace>@inbound.tickzy.app`): simplest; via a provider's inbound webhook (Amazon SES receipt rules → S3 + SNS; Postmark Inbound; SendGrid Inbound Parse; Mailgun Routes) *(K)*.
- **Mailbox connection model** (Gmail API with push via Pub/Sub watch; Microsoft Graph mail subscriptions): needed for **personal email sync** (Pylon feature: CSM 1:1 emails appear on the account) *(K)*.
- Threading: RFC 5322 `Message-ID`, `In-Reply-To`, `References`; fallback to subject + participants heuristics; plus a reply-token in `Reply-To` or plus-addressing (`support+t_abc123@`) for robust matching *(K)*.
- Parsing: quoted-text stripping (e.g., `email-reply-parser` algorithms, or LLM-assisted fallback), signature extraction, inline images (CID) → object storage, attachment limits, HTML sanitisation (DOMPurify-equivalent server-side), charset handling.
- Hygiene: spam & **auto-reply/bounce detection** (`Auto-Submitted`, `X-Autoreply`, `Precedence: bulk`, DSNs) — Plain documents this as a feature; also bot-loop guards (Plain's Customer Agent stops after 3 replies to an automated sender).

### 3.2 Outbound
- Send as customer domain: DKIM (CNAME delegation), SPF include, DMARC alignment, custom Return-Path; dedicated vs shared IP pools; suppression lists (Pylon exposes email suppressions API); bounce/complaint webhooks → issue event ("Email not delivered" trigger in Pylon).
- Providers to evaluate: Amazon SES (cheapest, more ops), Postmark (best deliverability/DX, inbound+outbound), Resend (React Email DX; inbound newer) — decision deferred to tech comparison.

## 4. Discord
- Gateway (WebSocket) connection with intents; **MESSAGE_CONTENT is a privileged intent** requiring verification once a bot is in 100+ servers *(K)*. Forum channels map well to tickets (each post = thread). Threads, reactions, components (buttons). Pylon and Plain support Discord; community support (dev-tools) is the use case.

## 5. In-app chat widget & portal
- Embeddable widget (JS snippet + npm package + iOS/Android/React Native SDKs as in Pylon), **identity verification via HMAC/JWT** of user ID/email (Pylon, Intercom), custom domain, JS API (open, prefill, identify, track), attachments, typing indicators, read receipts, offline → email fallback, AI agent first-responder with handoff.
- Transport: WebSocket with SSE/long-poll fallback; message ordering via per-conversation sequence numbers.
- **Headless mode** (Plain): APIs + React hooks so customers build their own UI.
- Customer portal: SSO with the customer's product (JWT), **account-level visibility rules** (who in the customer org can see which tickets — the HN-raised need).

## 6. Other messaging
- **WhatsApp Business Platform**: 24-hour customer-service window; outside it only pre-approved templates; per-conversation pricing by Meta *(K)*. **SMS/Voice**: Twilio/Telnyx. **Telegram**: Bot API. **Google Chat**: Chat API (Pylon Advanced+). All are lower priority for B2B SaaS than Slack/Teams/email/widget.

## 7. Unified channel abstraction (design implication)
Every channel adapter implements the same contract (inspired by Front's Channel API and Plain's thread model):
```
inbound:  RawEvent → normalize() → {external_ids, author, body(blocks), attachments, thread_hint, timestamps}
segment:  (conversation_state, message) → {attach_to: issue_id | new_issue, confidence}
outbound: (issue, message, sender_identity) → deliver() → {external_message_id, status}
sync:     edits, deletes, reactions, read state, membership events
limits:   per-adapter rate-limit budget + backoff; idempotency keys
```
Expose this as a public **Channel SDK** later so the long tail (Zulip, Mattermost, Intercom-migrations, custom) can be built by others.

## 8. Unknowns
- Exact Slack Marketplace review timeline/requirements beyond 10 installs.
- Whether Block Kit interactive elements work for external users in Slack Connect for all app types.
- Official Microsoft docs on shared-channel message notifications in 2026.
- Legal interpretation of Slack ToS for AI features.

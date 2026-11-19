# Front — Investigation

- **Research date:** 2026-11-19 · **Mission:** M08
- **Primary sources:** [front.com/llms.txt](https://front.com/llms.txt), [front.com/pricing](https://front.com/pricing), [dev.frontapp.com llms.txt](https://dev.frontapp.com/llms.txt). Secondary: [featurebase pricing teardown](https://www.featurebase.app/blog/front-pricing), [eesel Front AI](https://eesel.ai/blog/front-ai), [myaskai AI pricing](https://myaskai.com/blog/front-ai-pricing-explained).
- **Confidence:** HIGH pricing (vendor page); MEDIUM feature detail (vendor + product knowledge).

## 1. Position — VERIFIED
"Modern CX platform combining client communication, automation, analytics" — originated as the **collaborative shared inbox** (email-first) for teams that work client relationships (logistics, financial services, agencies, B2B services). Ticketing was added later on top of the inbox metaphor.

## 2. Pricing — VERIFIED ([front.com/pricing](https://front.com/pricing))
| Plan | Price (annual) | Limit |
|---|---|---|
| Starter | $25/seat/mo | ≤10 seats |
| Professional | $65/seat/mo | ≤50 seats |
| Enterprise | $105/seat/mo | — |
| Copilot / Smart QA / Smart CSAT | $20 / $20 / $10 per seat/mo (bundle QA+CSAT $25) | Included on Enterprise (PARTIALLY VERIFIED) |
| **Autopilot (AI agent)** | **from $0.39 per conversation** | Third-party blogs citing $0.05 are **OUTDATED** |
| **Extra API rate limit** | **$200 per +100 API requests/min per month** | Front monetises API throughput |

## 3. Signature features & UX patterns — PARTIALLY VERIFIED
- **Shared inboxes + individual inboxes**; conversation = thread of messages across channels (email, SMS, WhatsApp, social, chat, custom).
- **Internal comments with @mentions inside the email thread** (discussion beside the external conversation), **shared drafts**, **collision detection** ("X is replying"), assign/unassign, snooze, follow/unfollow, tags, rules (if/then on events), SLAs, analytics, round-robin/load-balancing, **message templates**.
- Ticketing layer: ticket statuses, ticket IDs, customer portal/knowledge base ("Resolve" self-serve).
- AI: Copilot (drafts, summaries, answers from KB), Autopilot (AI agent), Smart QA (auto-QA every conversation), Smart CSAT (predict CSAT without surveys).
- **Developer platform:** Core REST API, **Channel API** (build custom channels that sync into Front), **Plugin SDK** (sidebar apps, composer plugins), Application Framework, webhooks/application triggers, OAuth.

## 4. Weaknesses for B2B tech support (PARTIALLY VERIFIED — reviews)
- Email-first metaphor makes Slack Connect shared-channel support second-class (ClearFeed and Pylon market directly against this — [clearfeed.ai/comparisons/front](https://clearfeed.ai/comparisons/front), [usepylon.com/competitors/front](https://www.usepylon.com/competitors/front)).
- Seat caps per plan, add-on stacking for AI, API throughput sold separately.

## 5. Tickzy takeaways
1. **Collision detection, shared drafts and inline internal comments** are excellent collaboration primitives Tickzy should include in v1 (cheap with a realtime presence layer).
2. A **Channel API** (third parties implement a channel adapter) is the right extensibility model for long-tail channels — Tickzy's internal channel abstraction should be the same interface it exposes publicly.
3. Never charge for API throughput; publish generous limits.

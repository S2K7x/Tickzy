# Intercom (now "Fin") — Investigation

- **Research date:** 2026-11-19 · **Mission:** M06
- **Primary sources:** [intercom.com/llms.txt](https://www.intercom.com/llms.txt), [Facts about Intercom](https://www.intercom.com/ai-instructions) (reviewed Oct 2026), [fin.ai/llms.txt](https://fin.ai/llms.txt), [Facts about Fin](https://fin.ai/ai-instructions), [Fin AI Engine](https://fin.ai/ai-engine), [Fin CX Models](https://fin.ai/cx-models), [Intercom pricing](https://www.intercom.com/pricing), [developers.intercom.com llms.txt](https://developers.intercom.com/llms.txt), [Rate limiting](https://developers.intercom.com/docs/references/preview/rest-api/errors/rate-limiting.md), [Fin Custom Helpdesk API](https://developers.intercom.com/docs/guides/fin-custom-helpdesk/authentication.md).
- **Confidence:** HIGH (vendor primary). Performance figures are vendor claims → treat resolution-rate numbers as PARTIALLY VERIFIED.

## 1. Corporate shift — VERIFIED
**"Intercom is now Fin."** The company renamed itself Fin ("the Customer Agent company"); primary site is fin.ai. Products: **Fin AI Agent** (customer-facing, sold standalone into Zendesk, Salesforce, HubSpot, Freshdesk, and custom helpdesks) and **Intercom Helpdesk** (human workspace). Founded 2011. 30,000+ businesses use the products; Fin has **12,000+ customers and >2M resolutions/week**; claimed 76% average resolution rate "across conversations where Fin was involved" (denominator choice flatters the number). 60+ person AI research team led by Fergal Reid.

**Salesforce acquisition (VERIFIED, pending):** On 2026-06-15 Salesforce signed a definitive agreement to acquire Fin for ~$3.6B, to fold into Agentforce; close expected in Salesforce's FY27 Q4 pending regulatory clearance ([Salesforce press release](https://www.salesforce.com/news/press-releases/2026/06/15/salesforce-signs-definitive-agreement-to-acquire-fin), [TechRepublic](https://www.techrepublic.com/article/news-salesforce-acquires-fin-agentforce-ai-agents/), [CX Today](https://www.cxtoday.com/?p=942788) — reports Fin ≈ $100M of Intercom's ~$400M ARR). One aggregator lists it as closed on 2026-09-10 — **UNVERIFIED**. HN discussion ([thread](https://news.ycombinator.com/item?id=48540126), 241 comments) shows strong developer distrust of Salesforce stewardship ("Will never forgive how badly they've botched Heroku") and skepticism of AI support quality — **an opening for an independent, developer-trusted alternative and for migration offers to Intercom customers during the transition.**

Vision: one **Customer Agent** (all customer-facing communication: service, sales, onboarding, success) + an **Operations Agent ("Fin Operator")** that analyses the CX operation and makes changes with permission + human team.

## 2. Pricing — VERIFIED ([intercom.com/pricing](https://www.intercom.com/pricing))
| Item | Price |
|---|---|
| Helpdesk Essential | $29/seat/mo annual ($19 shown as early-stage promo) |
| Helpdesk Advanced | $85/seat/mo annual |
| Helpdesk Expert | $132/seat/mo annual |
| Fin AI Agent | **$0.99 per outcome** (on all plans; also standalone "from $99/workspace/mo incl. 500 messages"-type entry offers) |
| Fin Voice | $1.99 per voice outcome |
| Copilot (agent assistant) | $29/agent/mo annual ($35 monthly), unlimited; free for 10 conversations/agent/mo |
| "Pro" add-on (Operator/analysis) | $100/mo: 500 conversations analysed + 6,000 credits/mo; extra credits $0.01 each; usage alerts & hard limits |
| Early Stage | 93% off (<$10M raised, ≤15 employees) |

**Insight:** Intercom monetises AI three ways: per outcome (customer agent), per seat (copilot), and credits (operator/analysis). The $0.99/outcome anchor now defines market expectations; Plain (~$1.00/resolution via credits) matches it.

## 3. Helpdesk capabilities — VERIFIED (facts page) / PARTIALLY VERIFIED (detail from domain knowledge)
- Omnichannel inbox (chat/Messenger, email, phone, WhatsApp, social, SMS, Slack via Fin), **tickets** (Intercom distinguishes *customer tickets*, *back-office tickets* and *tracker tickets* that link many conversations to one problem — tracker = incident/bug parent, a strong pattern), no-code workflows for routing/SLAs/escalations, Copilot (drafts, surfaces answers, takes actions in connected systems), Help Center, Knowledge Hub, reporting with **CX Score** (AI-scored quality of every conversation instead of sampled CSAT), **Topics Explorer**, always-on QA.
- **Outbound / proactive:** product tours, checklists, tooltips, in-app messages, push, banners — Intercom's historical differentiator vs B2B-native tools (none of Pylon/Plain do in-product tours).
- Messenger with JWT identity verification, IP restrictions, SAML SSO.

## 4. Fin AI architecture — VERIFIED (vendor technical marketing)
Fin publicly documents a **pipeline of nine purpose-built models**, not one LLM:
| Stage | Model | Notes |
|---|---|---|
| Language detection | XLM-RoBERTa | 45 languages, handles typos/short msgs |
| Issue summarisation | Fin Issue Summarizer | Extracts the issue from history → better retrieval queries |
| Query refinement | (engine stage) | Rewrites query for comprehension |
| Retrieval | `fin-cx-retrieval` | Semantic search over articles, past conversations, snippets, connected systems |
| Reranking | `fin-cx-reranker` | Scores relevance/accuracy/usefulness |
| Generation | **Fin Apex 2.0** (custom post-trained model) | +8.6% confirmed resolutions, −16.5% hallucinations vs Apex 1.0 |
| Low-latency generation | Apex Flash 2.0 | for voice; 24% faster |
| Multi-step procedures | Apex for Procedures | claims to beat "Sonnet 5" (frontier model) on their eval |
| Feedback parsing | multi-task **ModernBERT** | sentiment, follow-up detection, conversation end |
| Escalation routing | multi-task **ModernBERT** | continue/offer/escalate with cited guideline; ">98% accuracy", 0.5s faster than LLM routing |
| Validation | engine stage | post-generation accuracy & safety check; OWASP LLM Top 10 defences |

Training data: de-identified past Fin interactions; **excluded**: customers with BAA, EU/AU-hosted workspaces, opt-outs. Third-party LLM providers under ZDR. Certifications: SOC 2, **ISO 42001** (AI management), HIPAA; 99.97% uptime claim.

Fin product surface: Procedures (multi-step business logic), Data Connectors (call your APIs), Guidance, Train/Test/Deploy/Analyze "flywheel", simulations/testing, CLI, API platform, memory of customer history.

**Tickzy implication (major):** the frontier has moved from "LLM + RAG" to **a cascade of small specialised models (classifiers/rerankers) around a generator**. Small encoder models (ModernBERT) handle routing/escalation/feedback cheaply and fast; generation is reserved for answers. Tickzy can't train Apex-class models early, but can (a) use frontier APIs for generation, (b) use cheap hosted rerankers/embeddings, and (c) fine-tune small encoder classifiers once it has labelled data. Design the AI pipeline as stages from day one so each stage can be swapped for a cheaper specialised model later.

## 5. Developer platform — VERIFIED
- REST API, **date-versioned** via `Intercom-Version` header with "supported versions", "unversioned changes" policy, preview version.
- Models: contacts (users/leads), companies, conversations with **conversation parts** (each message/note/assignment as a part; parts can be redacted), tickets & ticket types, data attributes, **data events** (custom product events on contacts), tags, segments, articles, help center.
- **Rate limits:** default 10,000 calls/min per app and 25,000/min per workspace (UNVERIFIED exact values in this pass), enforced in **10-second windows** (example: 1,000/min → 167 per 10s) with `X-RateLimit-Limit/Remaining/Reset`.
- Webhooks: topic subscriptions, webhook models.
- **Canvas Kit**: JSON UI framework for Messenger apps and Inbox apps (server returns canvas JSON; Intercom renders) — same declarative philosophy as Plain's UI components.
- **Fin Custom Helpdesk API:** standard endpoints + webhooks so *any* helpdesk can host Fin; two-legged OAuth inbound, `X-Webhook-Key` outbound, regional endpoints (US/EU/AU).

**Tickzy implication:** Tickzy can implement the Fin Custom Helpdesk contract so customers who already bought Fin can plug it in on day one — a cheap "BYO agent" story and a migration lever.

## 6. Weaknesses for B2B — PARTIALLY VERIFIED (reviews; see customer-feedback doc)
- B2C/PLG heritage: weaker account (company) model, no native Slack Connect channel model comparable to Pylon (Fin supports Slack as a channel).
- Price creep: seats + Copilot + outcome fees + Pro credits makes TCO hard to predict; reviewers repeatedly complain about bill surprises ([G2](https://www.g2.com/products/intercom/reviews), [Capterra](https://www.capterra.com/p/134347/Intercom/reviews/)) — UNVERIFIED in this pass beyond widely reported themes.
- Outcome definition controlled by vendor ("resolution" = customer didn't ask for human after answer / confirmed) → billing disputes.

## 7. Takeaways for Tickzy
1. Adopt the **multi-model pipeline** architecture (see `docs/research/ai-research/ai-architecture.md`).
2. Tracker-ticket pattern (one problem ↔ many conversations) + Pylon issue groups + Plain "close the loop" = one feature in Tickzy: **Problems**.
3. In-product outbound (tours/banners) is not core for B2B support v1; skip.
4. Publish clear, auditable outcome definitions if charging per resolution.

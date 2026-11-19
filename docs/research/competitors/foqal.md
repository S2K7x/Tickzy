# Foqal — Investigation

- **Research date:** 2026-11-19 · **Mission:** M04
- **Primary sources:** [foqal.io/llms.txt](https://foqal.io/llms.txt) (72 KB, detailed), [pricing](https://www.foqal.io/pricing); secondary: [Slack Marketplace](https://app.slack.com/marketplace/A016FPJ6XH6-agent), [Carahsoft public sector](https://www.carahsoft.com/foqal), [G2](https://www.g2.com/products/foqal/pricing), [HubSpot listing](https://ecosystem.hubspot.com/marketplace/listing/foqal-454608).
- **Confidence:** HIGH for positioning/pricing (vendor); customer results are vendor claims.

## 1. Positioning — VERIFIED
"AI-powered **operations** platform" for IT, HR, customer support and ops, native inside Slack and Microsoft Teams. Tagline "Run operations. Not just requests." Founder: Vlad Shlosberg (ex-LinkedIn security/collab infra). Increasingly an **ITSM/ESM** play (ServiceNow/JSM alternative at "10–20x lower cost"), with customer support as one of four "team" solutions. Public-sector reseller via Carahsoft.

## 2. Capabilities — VERIFIED
- **Request management:** capture from Slack, Teams, email, web forms; **8 Slack capture methods** (channel menu, message shortcuts, emoji triggers, `/foqal`, private mode, DM capture, threaded requests, Slack Connect); per-team queues with **visibility isolation**; routing by channel/type/keywords/requester; request types with structured fields.
- **Workflow automations:** no-code visual builder; IF/THEN, approvals (manager looked up from IdP), integration actions (Okta user create, Jamf device assign, Jira issue, Salesforce update), **scheduled actions**, **Secrets Manager** vault feeding automations at runtime.
- **AI:** deflection from Notion/Confluence/Guru/help centers/**past tickets**; auto-priority & categorisation; AI Assist summaries; **bring-your-own AI provider** (OpenAI and Anthropic Claude integrations listed as automation steps).
- **Customer support:** one inbox for Slack Connect + Teams customer channels, CRM context (tier, ARR, health score), SLA timers + **pre-breach escalations**, bi-directional Zendesk/Jira/Salesforce sync, customer escalation management with AI urgency detection.
- Security: SOC 2 Type II, GDPR, HIPAA-aligned (BAA Enterprise), CCPA; AES-256 / TLS 1.3; SSO SAML + SCIM; RBAC; audit logs.

## 3. Pricing — VERIFIED (llms.txt)
Starter **$100/mo flat (≤5 operators)**; Premium **$50/operator/mo (min 3)**; Enterprise **$75/operator/mo (min 10)**. **Requesters free & unlimited.** 30-day trial. "Oncall licensing" concept (rotating on-call operators — details on pricing FAQ, not extracted).

## 4. Tickzy takeaways
1. Foqal shows the **internal-support (ESM) adjacency** is large and cheaper to win than enterprise CX; Tickzy's data model should not preclude internal helpdesk use (requesters = employees) — but it's a later expansion, not v1.
2. Secrets vault for automation actions and BYO AI provider are enterprise-trust features worth copying.
3. "Requesters free" is universal; the pricing debate is about **operators vs occasional collaborators**.

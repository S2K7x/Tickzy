# AI Capability Comparison

- **Last updated:** 2026-11-19 · Detailed analysis: `docs/research/ai-research/ai-architecture.md` (capability table §1, pricing in `docs/research/pricing-research/pricing-analysis.md`).

| Dimension | Leader | How they do it (VERIFIED) | Tickzy target |
|---|---|---|---|
| Answer quality/safety engineering | **Fin** | 9 specialised models: XLM-R language detect, issue summariser, custom retriever + reranker, Apex 2.0 generator, ModernBERT escalation router (>98% claimed), feedback parser, validator ([fin.ai/cx-models](https://fin.ai/cx-models)) | staged pipeline, frontier models first, swap stages for small models later |
| Handoff policy specificity | **Plain** | enumerated default reasons, human-replied lock, bot-loop guard, 6 rounds/45 s budgets ([handoffs](https://www.plain.com/docs/product/agents/ari/handoffs)) | adopt + make editable/versioned |
| Pre-deploy testing | **Pylon** | backtests on real past issues, ≤3 variants, auto-graded by QA rubric ([test](https://docs.usepylon.com/pylon-docs/agents/support-agent/test.md)) | adopt + regression gates |
| Live shadowing | **Plain** | test mode per assignment, private timeline entries ([test mode](https://www.plain.com/docs/product/agents/ari/test-mode)) | adopt |
| Action safety | **Plain** | run-directly vs requires-approval classes, approvals in Slack ([approvals](https://www.plain.com/docs/product/agents/sidekick/actions-and-approvals)) | adopt with risk classes per tool |
| Transparency | **Thena** | AI logs tab, executions page ([AI logs](https://docs.thena.ai/guides/ticketing/ai-logs.md)) | AI events in timeline with sources, cost, model |
| Procedures | **Pylon / Fin** | runbooks executable by AI or human ([runbooks](https://docs.usepylon.com/pylon-docs/agents/support-agent/build/runbooks.md)); Fin Procedures w/ dedicated model | runbooks/skills (markdown, importable) |
| Openness | **Plain** | connected agents as machine users; Fin/Decimal/Duckie/Parahelp/Inkeep partners | BYO agent + BYO LLM key + Fin custom-helpdesk compat |
| Data/provider transparency | **Plain** | names OpenAI + Anthropic, ZDR, per-feature off switches ([AI & data](https://www.plain.com/docs/product/security/ai-and-your-data)) | name providers, region-pinned inference, per-feature toggles |
| Price | **Front / Help Scout** | $0.39/conversation; $0.75/resolution | ≤ $0.75 with honest definition + spend caps |
| Metric honesty | none | Pylon counts customer drop-off as resolved; Fin's 76% is "where Fin was involved" | publish strict definitions |

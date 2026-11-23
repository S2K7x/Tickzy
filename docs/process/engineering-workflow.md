# Engineering Workflow & Definition of Done

How every change moves through Stages 5–7 of [`development-pipeline.md`](development-pipeline.md). Binding for humans and AI coding agents (see `CLAUDE.md`).

## 1. Per-task loop
1. **Orient** — read `CURRENT-STATE.md`, the task in `docs/blueprint/backlog.md`, and the docs it references (requirements, ADRs, UX spec). Confirm dependencies are ✅.
2. **Plan** — restate the expected outcome and acceptance criteria; note any decision that would change the architecture → stop and write/propose an ADR first (never change architecture silently).
3. **Implement in small, verifiable steps** — tests alongside code (unit for pure logic, integration against real Postgres for anything touching data, RLS isolation for every new tenant table).
4. **Verify** — run the gates below; for UI also run the real-browser responsive/a11y check; for running services do a real-process smoke test. Never claim something works without having run it.
5. **Document** — update `CURRENT-STATE.md`, the backlog/master checklist, `docs/process/pipeline-checklist.md` if a stage item changed, and ADRs for any design decision.
6. **Commit & integrate** — small commits with clear messages on a short-lived branch; push; CI must be green before merge.

## 2. Branching & integration (trunk-based)
- `main` is always releasable. Work happens on short-lived branches (hours to ~2 days) merged via pull request.
- Unfinished user-facing features ship dark behind a **feature flag** (`workspace_flags`, introduced with the first flagged feature); remove flags once fully rolled out.
- Database migrations follow **expand → migrate → contract** so every deploy is backward compatible; applied migration files are never edited (the runner rejects changed checksums).

## 3. Definition of Done (every change)
- [ ] Acceptance criteria of the task met and demonstrated by tests.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass locally; CI green.
- [ ] New tenant-scoped table → RLS enabled + forced + isolation tests.
- [ ] New endpoint → zod schemas (OpenAPI), permission check, error envelope, integration tests incl. 401/403/404/422 paths.
- [ ] UI → light + dark, 390/768/1280 widths, keyboard accessible, zero serious axe violations, no fake data.
- [ ] Security: input validated, no secrets in code/logs, outbound URLs SSRF-guarded, audit entries for admin actions.
- [ ] Observability: errors logged with request/workspace ids; metrics/traces for new background work.
- [ ] Docs updated (CURRENT-STATE, checklists, ADR if a decision was made).
- [ ] No duplication of existing functionality; no silent architectural change.

## 4. Definition of Ready (before starting a task)
- Task has an ID, outcome, acceptance criteria and test requirements in `backlog.md`.
- Dependencies are done.
- Open questions answered or recorded as assumptions in the task notes.

## 5. Review
- Automated: lint, types, tests, (from M1) dependency and secret scanning, (from M3) SAST.
- AI review of the diff for correctness and security on non-trivial changes.
- Human (founder) review required for: auth, permissions/RLS, cryptography/secrets, billing, data deletion/export, migrations that drop or rewrite data.

## 6. Cycle rhythm
- 2-week cycles with a written goal in `CURRENT-STATE.md`; ~20% capacity reserved for tech debt, security updates and bug fixes.
- End of cycle: short review & retro note in `docs/progress/` (shipped, DORA/quality numbers, what to change).

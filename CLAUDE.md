# Ultimate ERP — working agreement

Multi-tenant, bilingual (EN/AR, full RTL) ERP for audit, risk & GRC firms, deployable as SaaS or on-premises. Kuwait first (KWD, 3 decimals).

## Before doing anything
1. Read `docs/project-status.md` (where we are, open questions, next step).
2. Read `docs/roadmap.md` and the relevant docs in `docs/` and `docs/decisions/` before changing architecture.
3. The owner's master project prompt (the "product brief") is binding in full. `docs/requirements-checklist.md` traces every section of it; check the rows for the current milestone before starting, and update their status at the end. If `docs/product-brief.md` exists, it is the original text.

## Rules
- Build phase by phase. Stop after each milestone and wait for the owner's explicit approval before starting the next one.
- Before a feature: explain its purpose, how it fits the ERP, data, dependencies, permissions/security, acceptance criteria and test plan. For modules, write `docs/modules/<module>.md` covering every item the brief lists for it.
- After a feature, hand over with: what was built, why, how it works, files changed and what each does, frontend↔backend flow, database involvement, auth/permissions, what could go wrong, how it was tested (real counts), manual verification (exact commands + expected output), what remains incomplete, next step.
- Definition of done: functionality, business rules, permissions, validation, loading/empty/error states, cross-module integration, passing tests, updated docs, no unresolved critical/high defects, owner approval.
- Run `pnpm check` and `pnpm security` before every hand-over.
- The owner is learning. Explain reasoning in plain language; don't assume they know concepts like git remotes or migrations.
- No fake functionality in production code: no mock data outside clearly isolated fixtures, no simulated auth, no hardcoded success. Never claim a test passed unless it ran and passed.
- Tenant isolation, server-side authorization and validation are release-blocking. Never trust a company ID from the client.
- Money: never floats; `numeric(20,3)` + currency; strings over the API.
- All UI text through i18n catalogs (EN + AR); logical CSS properties only.
- Design: follow `docs/design-system.md` (v0.2, vibrant pastel card style). Do not drift toward neutral/minimal "generic SaaS" styling. Reference preview: https://claude.ai/artifact/Ffk4Wtd2i9PGtVEK6FHA8H
- Keep `docs/project-status.md` updated at the end of every milestone.
- Commit or push only when the owner asks.

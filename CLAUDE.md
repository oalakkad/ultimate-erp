# Ultimate ERP — working agreement

Multi-tenant, bilingual (EN/AR, full RTL) ERP for audit, risk & GRC firms, deployable as SaaS or on-premises. Kuwait first (KWD, 3 decimals).

## Before doing anything
1. Read the **newest entry in `docs/session-log.md`** — exactly where the last session stopped, repo state, and the next step.
2. Read `docs/project-status.md` (where we are, open questions, how to verify).
3. Read `docs/roadmap.md` and the relevant docs in `docs/` and `docs/decisions/` before changing architecture.
4. The owner's master project prompt, `docs/product-brief.md`, is binding in full. `docs/requirements-checklist.md` traces every section of it; check the rows for the current milestone before starting, and update their status at the end.

## Before ending a session (always — the owner relies on this)
Add a new entry at the top of `docs/session-log.md`: what was done, repo state (last commit, uncommitted work, running services, changed local files like `.env`), real verification results, decisions made, items waiting on the owner, and the exact next step. Update `docs/project-status.md` and the checklist to match.

## Rules
- Build phase by phase. **Owner decision 2026-10-29: work nonstop.** When a milestone passes `pnpm check` + `pnpm security` (+ browser tests where relevant), write its hand-over (A–H) into the session log, commit it, and continue with the next milestone without waiting. For decisions, pick the recommended option and record it in `docs/project-status.md` ("Decisions") so the owner can review or reverse it any time. Stop only when the owner says stop, a release-blocking defect cannot be fixed, or a step needs real credentials, payment, or legal sign-off.
- Legal/financial rules (Kuwaiti labour law, leave, end-of-service, PIFSS, tax): build them as **configurable company settings**, pre-filled with best-understood values and clearly marked "to be verified by a Kuwaiti lawyer/accountant" in the UI and docs — never presented as legal advice (owner decision 2026-10-29).
- Before a feature: explain its purpose, how it fits the ERP, data, dependencies, permissions/security, acceptance criteria and test plan. For modules, write `docs/modules/<module>.md` covering every item the brief lists for it.
- Before each major module: a short plan and the decisions needing owner approval (brief §22).
- After a module, hand over in the brief's §22 format — **A** what was built, **B** files created/modified and their roles, **C** architecture (how it connects), **D** security, **E** testing (tests actually run, real results), **F** manual verification checklist (exact commands + expected output), **G** outstanding issues (bugs, gaps, debt, risks), **H** next step (then wait). Also explain, per §19, frontend↔backend flow, database involvement, what could go wrong, and new concepts in plain language.
- Definition of done: functionality, business rules, permissions, validation, loading/empty/error states, cross-module integration, passing tests, updated docs, no unresolved critical/high defects, owner approval.
- Run `pnpm check` and `pnpm security` before every hand-over.
- The owner is learning. Explain reasoning in plain language; don't assume they know concepts like git remotes or migrations.
- No fake functionality in production code: no mock data outside clearly isolated fixtures, no simulated auth, no hardcoded success. Never claim a test passed unless it ran and passed.
- Tenant isolation, server-side authorization and validation are release-blocking. Never trust a company ID from the client.
- Money: never floats; `numeric(20,3)` + currency; strings over the API.
- All UI text through i18n catalogs (EN + AR); logical CSS properties only.
- Design: follow `docs/design-system.md` (v0.2, vibrant pastel card style). Do not drift toward neutral/minimal "generic SaaS" styling. Reference preview: https://claude.ai/artifact/Ffk4Wtd2i9PGtVEK6FHA8H
- Keep `docs/project-status.md` updated at the end of every milestone.
- Commit each verified milestone (owner-authorized 2026-10-29, see above). Push only when the owner asks.

# Project Status

Last updated: 2026-10-28

## Current phase
Phase 1 — Foundation. Milestone 1.1 approved and committed (`c3d09be`). Milestone 1.2 approved and committed (`097350e`). Milestone 1.3a approved and committed (`253b180`). Milestone 1.3b approved and committed (`4ae3f76`). Milestone 1.4a approved and committed (`b875341`). Milestone 1.4b approved and committed (`f1f9276`). **Milestone 1.5a approved and committed (`511f52e`). Milestone 1.5b (files, monitoring, Dockerfiles) built and committed 2026-10-29 in nonstop mode. **Phase 1 complete.** Phase 2 (2a shell, 2b dashboard) built and committed 2026-10-29. Phase 3 (Clients / CRM), Phase 4 (Contracts & engagement letters) Phase 5 (Projects & budgeting) Phases 6 (Tasks), 7 (Timesheets), 8 (Employees & teams), 9 (Leave), 10 (Attendance), 11 (Payroll, test-only until rules are verified) and 12 (Invoicing) built and committed 2026-10-30. Phase 13 (Notifications & announcements), Phase 12b (Expenses), design v0.3 and Phase 14 (Reports & audit search) built and committed 2026-10-31. Phase 15 (Hardening & release prep, plan `hardening.md`): **15a (backup, restore, clean install) built and committed 2026-10-31. Next: 15b (production configuration & deployment validation).**** All work is traced against `product-brief.md` in `requirements-checklist.md`; session hand-offs are in `session-log.md`.

## Confirmed decisions
- Jurisdiction: Kuwait. Currency: KWD (3 decimals).
- Languages: English + Arabic, user-switchable, full RTL.
- Business model: multi-tenant SaaS from day one; the founder does not operate a company of their own (no pilot tenant yet).
- Hosting: vendor cloud or customer on-premises — same codebase.
- Target market: audit, risk & GRC firms first, generic professional services next.
- Repository: `C:\dev\ultimate-erp` (outside OneDrive), git initialized locally. Git identity (repo-local): `omar alakkad`. GitHub remote to be added.
- Tooling versions pinned at 1.1 (see ADR-0002 amendments): TypeScript 6.0.3 (not 7 — lint tooling unsupported), NestJS 12 (ESM), pnpm 12, PostgreSQL 18.6.
- Local object storage: RustFS replaces MinIO (MinIO no longer publishes images). ADR-0002 amendment.
- Drizzle ORM 0.45.4 stable (not the 1.0 release candidate). IDs: PostgreSQL 18 `uuidv7()`.
- Database roles erp_migrator / erp_app / erp_platform; forced RLS on every tenant table (ADR-0003 implementation notes, `database.md`).
- Companies and memberships are never deleted (status instead).

## Decisions 2026-10-25 (Milestone 1.3)
- 1.3 split into **1.3a Identity** and **1.3b Access**, reviewed separately.
- Company creation: **self-service for anyone after email verification** (rate-limited, audited).
- MFA: **required for sensitive roles** (Owner, CEO, payroll, payments, roles, exports); optional for others; tenant can require for all.
- Better Auth minimum raised to latest (1.7.13) after advisory GHSA-qq9h-g4jm-xgf3; email-OTP / magic-link sign-in not enabled.

## Decisions 2026-10-27 (Milestone 1.3b)
- Roles: **fixed system roles** from permissions.md now; custom roles later (company settings).
- MFA: sensitive roles are **blocked until two-factor is set up** (only MFA setup allowed in that company); no trusted device for them.
- Invitations: **Owner and CEO only**; expire after 7 days; accepted only by a signed-in account with the matching verified email.
- **One account may belong to several companies** (company switcher in Phase 2).
- Defaults accepted: audit log readable by Owner/CEO, kept indefinitely until legal retention is confirmed; API docs at /api/v1/docs in development only.

## Decisions 2026-10-28 (Milestone 1.4)
- 1.4 split: **1.4a** web app + design system (tokens, fonts, EN/AR + RTL, core components, gallery page for visual review) and **1.4b** real screens (sign-up/in, two-factor with QR, onboarding, invitations, sessions, app shell) + Playwright E2E + axe.
- Sidebar shows **only built modules** (no locked placeholders).
- First-visit language: **company default on a company address, browser language on the main address**; a signed-in user's saved choice always wins.

## Decisions 2026-10-28 (Milestone 1.4b)
- Sign-in: **once on the main address, then a secure hand-off** to a company: one-time, 60-second, single-use ticket bound to that company, exchanged for a separate host-only session there (session age carried over so the 12 h limit cannot be extended).
- 1.4b includes a **Members screen** for Owners/CEOs (invite, roles, remove, pending invitations).

## Decisions 2026-10-28 (Milestone 1.5)
- 1.5 split: **1.5a** background worker + outbox + notifications (email retries + in-app); **1.5b** files, monitoring, Dockerfiles.
- Error monitoring: **Sentry-protocol reporting, configurable, off by default** (works with Sentry cloud or self-hosted GlitchTip; nothing leaves the server unless configured).
- Uploads: **virus-scanned with ClamAV** (files pending until clean).
- 1.5a includes the **notification bell** (unread count + list).

## Decisions 2026-10-29 (working mode)
- **Nonstop:** milestones are built back-to-back; each verified one is committed; Claude picks the recommended option for each decision and records it here.
- **Kuwaiti legal values** (leave, end-of-service, PIFSS, tax): configurable company settings, pre-filled, marked "to be verified by a Kuwaiti lawyer/accountant"; no real payroll before verification.

## Decisions 2026-10-30 (Phase 5, Claude in nonstop mode — reviewable)
- "Engagement" is only a display word; the data is "project". Billing methods: fixed price, time & materials, retainer, non-billable.
- Budgets are never edited in place: each change is a numbered revision with a reason (append-only in the database).
- A linked contract must belong to the project's client (enforced by a database key).
- Project scope: a Manager manages only projects they lead or are on; Team leads and Employees see only their projects; others get "not found".
- Warnings: "approaching" at 80 % of budgeted hours allocated/approved, "exceeded" above 100 % (live once Phases 6–7 supply hours).

## Decisions 2026-10-30 (Phase 6, Claude in nonstop mode — reviewable)
- Over-budget allocations are blocked; only Owner/CEO (`projects.budget.override`, two-factor) can override, with a recorded reason.
- Assignees must be on the project team; someone with hours on a project stays on its team.
- Cancelled tasks release their hours; completed tasks keep them.
- Task titles are single free text; recurring tasks, calendar view and board drag-and-drop are not built (low value before timesheets).
- Workload shows open allocated hours per person; capacity limits wait for employee records (Phase 8) and will warn, not block.
- Overdue alert once per task (re-armed by a new due date); team leads get project scope for tasks until teams exist.

## Decisions 2026-10-30 (Phase 7, Claude in nonstop mode — reviewable)
- Work week Sunday–Saturday (Kuwait); a company setting can change it later.
- Time is approved per entry by the project's manager (Owner/CEO anywhere); nobody approves their own time (API + database).
- Only people allocated to a task log time on it; someone with logged time stays on the task.
- Approved time is locked; approvers can reopen an entry with a reason (audited).
- Overtime and profitability are not computed until payroll rules and cost rates exist (Phases 11–12).

## Decisions 2026-10-30 (Phase 8, Claude in nonstop mode — reviewable)
- Employee records are created by HR for existing members; not every member must be an employee.
- Private details and emergency contacts are encrypted with a new, separate key `DATA_ENCRYPTION_KEY` (added to `.env.example`, the production compose example and the local `.env`). **Back it up: without it that data cannot be read.**
- Three access levels: directory, employment details (company readers, HR, the person, their manager), restricted (Owner, CEO with two-factor, HR & payroll, the person).
- "Team" scope = teams I lead + my direct reports. Default schedule Sunday–Thursday, 40 h/week (per employee, not a legal value).
- Leaving suspends the person's access to the company and clears their teams; the record becomes read-only.

## Decisions 2026-10-30 (Phase 9, Claude in nonstop mode — reviewable)
- Pre-filled leave types, **all flagged "to be verified by a Kuwaiti lawyer/accountant"**: Annual 30 working days/year accrued monthly; Sick 15 days/year with a document; Unpaid (no balance); Maternity 70 days with a document. An Owner/HR ticks "verified" after professional review.
- Working days come from each person's schedule (default Sunday–Thursday); public holidays are entered by the company each year.
- Balances are a ledger: accrued − taken + restored ± adjustments; no automatic carry-over or expiry (HR adjusts with a note).
- Team leads and direct managers approve their people; Owner/CEO/HR approve anyone; nobody approves their own (API + database).

## Decisions 2026-10-30 (Phase 10, Claude in nonstop mode — reviewable)
- Kiosk QR codes rotate every 30 seconds, are HMAC-signed with a key derived from the server secret, accepted in the current or previous window, once per person per window, only from signed-in members; time is the server's.
- No GPS and no stored IP addresses; presence comes from the kiosk at the office. Web check-in is on by default (people work at client sites) and can be switched off.
- No offline check-ins; outages and mistakes go through corrections approved by team lead/manager/HR; nobody approves their own.
- Late = minutes after shift start once beyond the grace; the shift's break is deducted from worked time.

## Decisions 2026-10-30 (Phase 11, Claude in nonstop mode — reviewable)
- Jurisdiction Kuwait; **no formula invented**: overtime, late deduction and social insurance start **off** (social insurance at 0 %); planning defaults (26 working days, 208 hours, overtime × 1.25, unpaid-leave deduction on) are flagged with the whole rule set "to be verified".
- **A run is a test run until a CEO confirms that a Kuwaiti lawyer/accountant verified its rule version; test runs can never be marked paid** (API + database).
- Prepare (HR & payroll or CEO) → approve → mark paid; never the same person who prepared; one live run per month.
- Overtime hours are an explicit input; end-of-service, WPS files and PIFSS reports wait for verified rules.
- Every role that can be an employee sees its own approved payslips.

## Decisions 2026-10-31 (Phase 15 plan, Claude in nonstop mode — reviewable; details in `hardening.md` §3)
- Phase 15 split into 15a backup/restore + clean install, 15b production config + deployment validation, 15c performance, 15d security/isolation/accessibility/monitoring/readiness.
- Backups: built-in `pg_dump` + file-bucket mirror for both profiles; SaaS production also uses managed point-in-time recovery. Default targets RPO 24 h on-prem / ≤ 5 min SaaS, RTO 4 h, retention 30 daily + 12 monthly (to confirm with the first customer).
- Load testing with autocannon (MIT) from a Node script, not k6.
- No real cloud deployment until the owner provides an account, domain and SMTP provider; deployment is proven on the production compose locally and in CI.
- An external penetration test is recommended before the first paying customer.

## Decisions 2026-10-31 (Phase 15a, Claude in nonstop mode — reviewable)
- Backups contain the database and every stored file that a file record points to (unreferenced objects are unreachable leftovers and are skipped); infected files were deleted at scan time and are not expected.
- A restore goes only into an empty database and an empty bucket; it never overwrites. It refuses when `DATA_ENCRYPTION_KEY` / `AUTH_SECRET` differ from the backup's (one-way fingerprints in the manifest) unless `--allow-key-mismatch` is given.
- Jobs waiting at backup time (e.g. emails) are restored and will run; a few emails may be sent twice. `--sign-out-everyone` ends all sessions for post-incident restores.
- The manifest stays readable (row counts, checksums, no business data); everything else is encrypted with `BACKUP_ENCRYPTION_KEY` (a third secret, separate from the other two).
- On-prem: a one-shot `bootstrap` service creates the database roles (fixes the install gap), backups via `docker compose --profile ops run --rm backup`, scheduled by the host (cron).

## Decisions 2026-10-31 (Phase 14, Claude in nonstop mode — reviewable)
- Reports are computed on request from the live tables (no separate warehouse); periods up to 366 days; 2 000 rows on screen (export the rest).
- Each report needs its source module's permission; team / project-scoped versions show only the person's team or managed projects.
- Profitability = invoiced − approved expenses; staff cost is left out until payroll rules are verified (stated on screen).
- Utilization capacity = weekly hours ÷ work days × work days in the period, without subtracting holidays or leave (stated on screen).

## Decisions 2026-10-31 (design v0.3 — owner request, reviewable)
- Motion that explains, not decorates: arrivals, charts drawing, a data-derived peak annotation, feedback; no looping or decorative effects (gradient meshes, glass, glow, sparkles) — rejected in the design audit as reading "AI-generated". Rules in design-system.md §5–§6.
- Dashboard reorganised: "Needs your attention" (non-zero items only), 4 key numbers, revenue chart. Navigation grouped Main / Work / People / Finance.

## Decisions 2026-10-31 (Phase 12b, Claude in nonstop mode — reviewable)
- Expense claims have lines; numbers `EX-` on first submission; rejected claims can be reopened and keep their number.
- Approvers: the claimant's line manager / team lead (team scope) or Owner, CEO, Finance; nobody decides or reimburses their own claim (database-enforced).
- Reimbursement is recorded by Owner/CEO/Finance (paid outside the system); paying through payroll is a later option.
- Default categories and a 5.000 KWD receipt threshold are company settings (not legal rules).
- Billable expenses are re-billed at cost (no mark-up), each line once; voiding the invoice releases them.
- HR & payroll don't see others' expense claims (finance does).

## Decisions 2026-10-31 (Phase 13, Claude in nonstop mode — reviewable)
- Notification preferences default to in-app on, email copy off; security (roles changed) and announcements can't be muted in the app.
- Announcements are published by Owner, CEO or HR & payroll; the publisher must confirm the exact recipient count from a preview; at most 10 per company per day; published announcements can't be edited or deleted.
- Email copies only to verified addresses, in each person's language. No SMS/push yet (push with the mobile app).
- Next phase: 12b Expenses (included by default, open question 9) before Phase 14, because reports should cover expenses.

## Decisions 2026-10-30 (Phase 12, Claude in nonstop mode — reviewable)
- Invoice numbers (`INV-`) and credit notes (`CN-`) are assigned when issued; drafts are unnumbered and deletable.
- Issued invoices are never deleted: void (only without payments, with a reason) or credit note; payments are reversed with a reason, never deleted (database-enforced).
- No tax active by default (Kuwait has no VAT today); taxes are company settings flagged "to be verified by a Kuwaiti accountant".
- Payments are "recorded by staff" — distinct from provider-confirmed payments (no gateway yet). PDFs come from the bilingual print view.
- Overdue reminders go to Owner/CEO/Finance weekly, not to clients (no client delivery yet).

## Open questions
1. **GRC tooling scope** — deferred (2026-10-24). Build the core ERP (Phases 1–7) first; revisit GRC delivery tooling once the core works. Data model keeps "engagement" central so GRC modules can attach later.
2. **Design pilot** — no firm available yet. Seek feedback from 1–2 audit/GRC practitioners before Phase 5–7.
3. **Legal review** — when available, Kuwaiti counsel for items marked ⚖️ in `compliance.md`.
4. **Platform domain name** — none yet; dev uses `*.localhost` subdomains (no purchase needed until deployment).
5. **Design direction** — v0.2 approved 2026-10-24 (v0.1 rejected as generic). See `design-system.md`.
6. **Trademark** — search for the product name before launch (see `compliance.md` §3).
7. **On-prem object storage** — which S3-compatible product to bundle/recommend; decide before first on-prem customer.
8. **GitHub remote** — needed before the CI workflow can actually run on GitHub.
9. **Expenses module** — built as Phase 12b on 2026-10-31 (scope in `modules/expenses.md`; reviewable).

## Completed
- Phase 0 docs: architecture, ADR-0001..0007, domain model, security, permissions, compliance register, design direction, roadmap.
- **Milestone 1.1 — Skeleton** (2026-10-24):
  - pnpm workspaces + Turborepo monorepo; TypeScript strict (incl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); ESLint (type-aware strict) + Prettier; Vitest.
  - Docker Compose dev services: Postgres 18.6, RustFS (S3), Mailpit — all bound to 127.0.0.1, with health checks.
  - `apps/api` (NestJS 12): config validated at boot (refuses to start, never prints values), Pino JSON logs with redaction, correlation ID per request (`X-Request-Id`, incoming value only trusted behind a proxy), single error format with stable codes, JSON body size limit, Helmet security headers (CSP `default-src 'none'; frame-ancestors 'none'`), strict CORS allow-list, graceful shutdown.
  - `GET /api/v1/health` (readiness, 200/503 with DB status) and `GET /api/v1/health/live` (liveness).
  - `packages/contracts`: shared Zod schemas for errors and health.
  - GitHub Actions CI workflow (format, lint, typecheck, tests with real Postgres, build).
  - Tests: 37 passing (5 contracts, 32 API — config, log redaction, error mapping, HTTP behaviour, real-Postgres health incl. DB going down).
- **Milestone 1.1 follow-up — brief compliance review** (2026-10-24):
  - CI `security` job: production vulnerability audit (high+), licence allow-list check, gitleaks secret scan (verified it catches a planted token). Local: `pnpm security`.
  - Fixed high-severity advisory GHSA-q7qp-rjg7-q26m (multer, via @nestjs/platform-express) with a pnpm override to 2.5.0.
  - New docs: `requirements-checklist.md` (brief traceability), `testing.md` (strategy, 20 E2E workflows + negative tests mapped to phases), `api.md` (conventions incl. pagination, idempotency, versioning, errors).
  - Compliance evidence register populated for 1.1 controls; security.md §2a (remembered devices, suspicious login, SSRF, real-time, exports, secrets); domain-model deletion/correction policy, activity timeline, expenses; architecture environments (incl. staging), provisional performance targets; roadmap Milestone 1.5 (worker, files, notifications, monitoring) and Phase 2 / 12b scope.

- **Milestone 1.2 — Tenancy & isolation** (2026-10-24, owner-tested and approved 2026-10-25):
  - `packages/db`: Drizzle schema for `users` (global), `tenants`, `tenant_domains`, `memberships`; migrations 0000 (tables) + 0001 (RLS enabled+forced, policies, grants, triggers, `app.current_tenant_id()`, `app.resolve_tenant_by_host()`); `withTenant`; `assertSafeAppRole`; role bootstrap; migration runner; dev seed (acme/globex demo); Testcontainers helper.
  - API: `TenantDatabase` as the only data path; refuses superuser/BYPASSRLS connections (503); tenant resolved from Host on every route except health; `GET /api/v1/tenant` public profile.
  - Lint: no circular imports; business modules cannot import raw DB access.
  - Commands: `pnpm db:setup` (in `pnpm dev`), `db:seed`, `db:generate`.
  - Tests: 80 passing (contracts 5, db isolation 31, api 44). Mutation-checked.

- **Milestone 1.3a — Identity** (2026-10-25, owner-tested and approved 2026-10-27; email links made clickable during owner testing): Better Auth 1.7.13 behind our own `/api/v1/auth` endpoints (spec: `modules/identity.md`): sign-up with email verification (Mailpit), enumeration-safe answers, sign-in, lockout after 5 failures + email, per-IP limits (Postgres-backed), TOTP two-factor with replay protection, single-use backup codes, trusted device, password forgot/reset/change with breached-password check, sessions list/revoke (30 min idle / 12 h absolute), new-device notices, CSRF origin check, strict validation, bilingual emails (`packages/i18n`), query-string redaction in logs, telemetry off, hashed tokens. Tests: 131 passing; four protections mutation-checked.

- **Milestone 1.3b — Access** (2026-10-27, approved 2026-10-28; spec `modules/access.md`): self-service company onboarding (Owner + CEO, subdomain, reserved/taken slugs refused), invitations (verified matching email, single use, 7 days, revocable, hashed token, bilingual email), fixed roles + permission keys + scopes in `packages/contracts` (matrix machine-checked against permissions.md), AccessGuard (session → membership → MFA for sensitive roles → permission), no self-change / no escalation / last Owner kept with serialized role changes, company-host sign-in limited to members and invitees, no trusted devices for sensitive roles, append-only audit log (DB trigger, same transaction, cursor pagination), OpenAPI 3.1 generated from route contracts (dev only), `pnpm http` dev helper. Tests: 184 passing; five protections mutation-checked.

- **Milestone 1.4a — Design system** (2026-10-28, approved; spec `modules/web-ui.md`): `apps/web` (React 19, Vite 8, TanStack Router/Query, same-origin /api proxy), `packages/ui` (tokens from the approved preview, light/dark/system, self-hosted fonts, Tailwind 4 + Radix: buttons, fields, select, checkbox, cards, tiles, stats, status chips, avatars, dialog, drawer, tooltip, toasts, tabs, loading/empty/error/denied states, app frame/sidebar/top bar), `packages/i18n` UI catalogs + ICU + money/date formatting, language/theme switches with RTL, gallery page. Tests: 199 unit/integration + 6 browser (axe clean in EN/AR × light/dark).

- **Milestone 1.4b — Screens & E2E** (2026-10-28, awaiting approval; spec `modules/web-ui.md` §8–§14): sign-up, check/confirm email, sign-in with two-factor/backup code, forgot/reset password, companies list + create, secure hand-off to the company address (one-time 60 s ticket), invitation accept, app shell (only built modules, profile, theme/language, sign out), dashboard empty state, Members (invite, roles, remove, pending/revoke), My account (language saved to account, two-factor setup with locally drawn QR + backup codes, sessions). Every API error translated EN/AR. API: `PATCH /auth/me`, `GET /auth/companies`, `POST /auth/handoff` + `/redeem`, `WEB_PUBLIC_URL`. Tests: 223 unit/integration + 8 browser (full journey EN + AR, axe on every screen).

- **Milestone 1.5a — Jobs & notifications** (2026-10-29, awaiting approval; spec `modules/platform-jobs.md`): pg-boss worker (own process, in `pnpm dev`), transactional outbox, every email queued with encrypted payload and retried (6 attempts) with recorded status, notifications (member joined, roles changed) with bell + panel, "email not delivered" on pending invitations. Tests: 249 unit/integration + 8 browser.

- **Milestone 1.5b — Files, monitoring, packaging** (2026-10-29; spec `modules/files-monitoring.md`): uploads checked by content + size, stored privately per company, virus-scanned by ClamAV in the worker, downloadable only when clean via 5-minute signed links; error reports (Sentry protocol, off unless `SENTRY_DSN`, personal data scrubbed); slow-request log; Docker images for API/worker and web; on-prem compose example. Tests: 260 unit/integration + 8 browser.

- **Phase 2a — Shell** (2026-10-29; spec `modules/shell-dashboard.md`): command palette (Ctrl K / ⌘ K) with pages, actions and people, Arabic-aware search; company switcher; phone navigation drawer; breadcrumbs; in-app navigation; My account name and password change. Tests: 265 unit/integration + 8 browser.

- **Phase 2b — Dashboard** (2026-10-29): getting-started progress, team numbers, recent activity and quick actions from real records, each by permission; reusable accessible charts (bar, line, meter) shown in the gallery with labelled example data. Tests: 275 unit/integration + 8 browser.

- **Phase 3 — Clients / CRM** (2026-10-30; spec `modules/clients.md`): clients with bilingual names, numbers, duplicate protection, contacts and authorized representatives, communication history, virus-scanned documents, activity timeline, search/filter/sort/paging, CSV export, archive; dashboard card; palette search. Tests: 300 unit/integration + 8 browser.

- **Phase 14 — Reports, audit search & analytics** (2026-10-31; spec `modules/reports.md`): 13 reports with written definitions, filters, permission and scope per report, totals, formula-safe audited CSV exports; audit log search (area, actor, target, reference, dates) with screen and audited export. Tests: 385 unit/integration + 8 browser.

- **Phase 12b — Expenses** (2026-10-31; spec `modules/expenses.md`): claims with lines and receipts, configurable categories and receipt threshold, approval by line manager / team lead or Owner/CEO/Finance with separation of duties, send back and reopen, recorded reimbursement, project expense cost, re-billing to invoices once at cost, notifications, dashboard card. Tests: 381 unit/integration + 8 browser.

- **Phase 13 — Notifications & announcements** (2026-10-31; spec `modules/notifications.md`): per-person preferences (in-app / email copy; security and announcements mandatory), email copies in the reader's language through the outbox, budget-threshold and invoice-issued notices, bilingual company announcements to everyone or roles with recipient-count confirmation, daily limit, delivery counts and audit. Tests: 378 unit/integration + 8 browser.

- **Phase 12 — Invoicing & payments** (2026-10-30; spec `modules/billing.md`): drafts and issued invoices with lines, discounts, configured taxes, approved time billed once, recorded payments, partial payments, credit notes, void/reversal corrections (database-enforced), overdue reminders, aging, revenue, print view, client tab, dashboard card. Tests: 373 unit/integration + 8 browser.

- **Phase 11 — Payroll** (2026-10-30; spec `modules/payroll.md`): salary history, versioned rules (legal values off/flagged), explicit inputs, exact traceable engine using leave and attendance, prepare/approve/pay separation, test runs never payable, payslips, CSV export, audit. **Test-only until a Kuwaiti lawyer/accountant verifies the rules.** Tests: 366 unit/integration + 8 browser.

- **Phase 10 — Attendance** (2026-10-30; spec `modules/attendance.md`): rotating signed kiosk QR with replay protection, web check-in setting, shifts, late/early/absence/break rules, corrections with approval, auditable events, summaries vs timesheets, who-is-in board, dashboard card. Tests: 356 unit/integration + 8 browser.

- **Phase 9 — Leave management** (2026-10-30; spec `modules/leave.md`): configurable leave types (Kuwait defaults flagged "to be verified"), accrual, ledger balances with database-enforced single deduction, working days minus holidays, half days, documents, approve/reject/withdraw/cancel, overlap check, team calendar, notifications, dashboard card. Tests: 351 unit/integration + 8 browser.

- **Phase 8 — Employees & teams** (2026-10-30; spec `modules/people.md`): employee records with numbers, departments, teams, reporting line, lifecycle with on/offboarding checklists, schedules and capacity (utilisation), documents, encrypted private details and emergency contacts, employment history, three access levels. Tests: 346 unit/integration + 8 browser.

- **Phase 7 — Timesheets & time tracking** (2026-10-30; spec `modules/timesheets.md`): time entries on assigned tasks, timer, weekly timesheet, submit, approval by the project manager with send-back and correction, reopen of approved time (audited), duplicate and 24-hour guards, billable/non-billable, summaries, planned vs actual, real project actual/billable hours, dashboard Time card. Tests: 337 unit/integration + 8 browser.

- **Phase 6 — Tasks & hour allocation** (2026-10-30; spec `modules/tasks.md`): tasks with priority, dates, estimate, workflow, dependencies, comments, documents, activity; allocations per person checked against the project budget under a lock (simultaneous requests can't exceed it), Owner override with reason; live budget/workload preview; workload per person; assignment and overdue notifications; list + board; project Tasks tab; dashboard My work. Tests: 329 unit/integration + 8 browser.

- **Phase 5 — Projects & budgeting** (2026-10-30; spec `modules/projects.md`): projects per client with an optional contract of the same client, P- numbering, manager + team, status machine, budget hours/amount with revision history, hours summary with 80 %/100 % warnings, documents, activity, project-scoped access, client tab, dashboard card. Tests: 320 unit/integration + 8 browser.

- **Phase 4 — Contracts & engagement letters** (2026-10-30; spec `modules/contracts.md`): bilingual templates, CT-/EL- numbering, versions, draft → review → approved → sent → signed copy → active → expired/terminated with separation of duties, renewal reminders and expiry (daily 08:00 Kuwait), print view for PDF, client tab, dashboard card. Tests: 308 unit/integration + 8 browser.

## How to verify Phase 15a
1. `pnpm backup` — prints the counts and `Backup complete: …\backups\uerp-<time>`. Open `manifest.json` in that folder: row counts per table, file list, no business data; the `.enc` files are unreadable.
2. `pnpm backup:verify backups\uerp-<time>` — "is good: N rows, M stored files".
3. Restore drill without touching your data: `pnpm backup:restore backups\uerp-<time> --database erp_drill --bucket erp-drill` — "counts match the backup", "Restore complete". Run it again: refused ("not empty"). Clean up as in `operations.md` §4.
4. Automated drill: `pnpm --filter @ultimate-erp/api exec vitest run test/backup.spec.ts` (6 tests).
5. Read `docs/operations.md` §1 (the three secrets) and §3 (restore steps).

## How to verify Phase 14
1. `pnpm check` → api `261` (others as before); `pnpm e2e:journey` → `2 passed`.
2. Insights → Reports → Clients: the definition above the table explains each number; change the dates or pick a client; the Total row adds up; Export CSV downloads the same table. Revenue by month shows the chart. Insights → Audit log → Area "Invoices and payments": every invoice and payment action, newest first, with who did it; type a request reference from an error message to find that exact request.

## How to verify Phase 12b
1. `pnpm check` → api `257` (others as Phase 13); `pnpm e2e:journey` → `2 passed`.
2. As an employee: Expenses → New claim → add a line (category, description, amount; choose a project and tick "Bill to client" if the client pays; attach the receipt for amounts above 5.000) → Submit for approval (EX-0001). As their manager or the Owner: Expenses → To approve → open it → Approve. As the Owner or Finance: To reimburse → Record reimbursement. The project's page shows the Project expenses card; New invoice → From approved time with "Also re-bill… expenses" adds the expense line once.

## How to verify Phase 13
1. `pnpm check` → api `254` (others as Phase 12); `pnpm e2e:journey` → `2 passed`.
2. Announcements → write the title and text in both languages → Check recipients ("Will reach N people") → Publish. Every member sees it in the bell and on the Announcements page; with "Also send by email" ticked, the emails appear in Mailpit (http://localhost:8025) in each person's language. My account → Notifications: switch a type off in the app or turn on its email copy ("Roles changed" and "Announcements" always show in the app).

## How to verify Phase 12
1. `pnpm check` → api `249` (others as Phase 11); `pnpm e2e:journey` → `2 passed`.
2. Invoices → New invoice → choose a client and project → enter an hourly rate → "Create draft from time" (uses approved billable time once) or add lines by hand → Save draft → Issue (INV-0001). Record payment (partly) → status "Partly paid", outstanding updated. Print / PDF opens the bilingual invoice. Invoices → Aging and Revenue show the totals.

## How to verify Phase 11
1. `pnpm check` → api `242` (others as Phase 10); `pnpm e2e:journey` → `2 passed`.
2. Payroll → Salaries: record a salary. Runs → Start payroll run → Calculate → open a payslip's details (each line shows how it was calculated). It says "Test run". Submit. As a different CEO (or HR prepares and the CEO approves): Approve → the employee sees the payslip under My payslips. "Mark as paid" is not offered until a CEO confirms the rules were verified.

## How to verify Phase 10
1. `pnpm check` → api `232` (others as Phase 9); `pnpm e2e:journey` → `2 passed`.
2. Attendance → Setup → add a site → Open kiosk (shows a QR that changes every 30 s). Scan it with a phone signed in as an employee who has an employee record → "Checked in". Scan the same picture again a second time → refused. Attendance → Today shows them "In". Add a shift and assign it to see late/early minutes in My attendance.

## How to verify Phase 9
1. `pnpm check` → api `227` (others as Phase 8); `pnpm e2e:journey` → `2 passed`.
2. Leave → Policies: the four types show "To be verified". Add a public holiday. As an employee with a record: My leave → choose Annual leave, pick dates → the box shows working days and the balance after → Send. As their team lead or the Owner: Approvals → Approve → the balance drops once; Team calendar shows the leave.

## How to verify Phase 8
1. `pnpm check` → api `222` (others as Phase 7); `pnpm e2e:journey` → `2 passed`.
2. People → New employee record → choose a member → Create (E-0001). Open them → Private → Edit → enter a civil ID → Save. Organisation → add a department and a team, set the lead and members. Sign in as the team lead: People shows only their team, without employment details or private data.

## How to verify Phase 7
1. `pnpm check` → api `213` (others as Phase 6); `pnpm e2e:journey` → `2 passed`.
2. As someone assigned to a task: My time → choose the task, 3.5 hours → Add entry → Submit week. As that project's manager: the bell shows it; Time approvals → Select all → Approve. The project's Hours card now shows 3.5 approved; the task shows planned vs actual. Try approving your own time → not offered.

## How to verify Phase 6
1. `pnpm check` → api `205` (others as Phase 5); `pnpm e2e:journey` → `2 passed`.
2. Open a project with 100 budgeted hours → Tasks tab → New task. Tick three team members and give them 20, 15 and 10 hours: the box shows "This task 45 h · Remaining after 55 h" before you save. Try 60 more on another task → refused (an Owner sees an override option that needs a reason). As one of the assignees: the bell shows the assignment; open the task → Start work → comment. Tasks → Board shows it under In progress.

## How to verify Phase 5
1. `pnpm check` → api `196` (others as Phase 4); `pnpm e2e:journey` → `2 passed`.
2. Make a colleague Manager. As them: Projects → New project → pick the client, its contract, yourself as manager, 120 hours → Create. Budget tab → Revise budget (needs a reason) → history shows both revisions. Press "Start / resume". As an Employee who is not on the team, the project is not listed.

## How to verify Phase 4
1. `pnpm check` → api `184` (others as Phase 3); `pnpm e2e:journey` → `2 passed`.
2. Contracts → Templates → New template (use `{{client.name}}`). Make a colleague Manager; as them create an engagement letter from the template and submit. As Owner approve (you cannot approve your own submission), mark sent, record the signed copy, activate, then Print / Save as PDF.

## How to verify Phase 3
1. `pnpm check` → api `176`, db `39`, contracts `36` (others as 2b); `pnpm e2e:journey` → `2 passed`.
2. In a company: Clients → New client → fill both names → Create. Try the same name again → "A similar client already exists". Open the client: add a contact, log a call, upload a PDF (status turns Ready after the scan), check Activity. Search the list in Arabic. Export CSV (Owner/CEO).

## How to verify Phase 2b
1. `pnpm check` → api `162`, ui `16` (others as 2a) passed; `pnpm e2e:journey` → `2 passed`.
2. Open a company dashboard: the getting-started list ticks off as you set up two-factor and invite someone; Recent activity lists what happened; an Employee sees only quick actions and the "company is ready" note.
3. http://localhost:5173/gallery → Charts: hover or Tab onto a column; press "Show as table".

## How to verify Phase 2a
1. `pnpm check` → web `23` (others as 1.5b) passed; `pnpm e2e:journey` (with `pnpm dev`) → `2 passed`.
2. By hand in a company: press Ctrl K, type `mem`, press Enter → Members opens; in Arabic type `اعضاء`. Narrow the browser below 768 px → a menu button replaces the sidebar. Click the company name at the top of the sidebar to switch company.

## How to verify Milestone 1.5b
1. `pnpm check` → api `159`, db `37`, contracts `27`, web `18`, i18n `10`, ui `9` passed (the files suite starts ClamAV in Docker; first run downloads ~200 MB and takes a few minutes).
2. `docker build -f infra/docker/api.Dockerfile -t ultimate-erp-api .` and `docker build -f infra/docker/web.Dockerfile -t ultimate-erp-web .` both finish.
3. There is no upload screen yet (Phase 3); files are exercised by the tests.

## How to verify Milestone 1.5a
1. `pnpm check` → api `148`, db `37`, contracts `27`, web `18`, i18n `10`, ui `9` passed.
2. With `pnpm dev` running: `pnpm e2e:journey` → `2 passed`.
3. By hand: sign up at http://localhost:5173/sign-up — the email arrives in Mailpit (http://localhost:8025) a moment later, sent by the worker (look for `Email sent` in the `worker` lines of the `pnpm dev` output).
4. Retry: stop only Mailpit (`docker stop ultimate-erp-mailpit-1`), invite someone, wait a minute, start it again (`docker start ultimate-erp-mailpit-1`) — the invitation email still arrives at the next retry (waits double each time: 30 s, 1 min, 2 min, …, so allow a few minutes).
5. Invite a colleague, let them join → the Owner's bell shows 1; open it → it takes you to Members and the count goes back to 0.

## How to verify Milestone 1.4b
1. `pnpm check` → i18n `10`, contracts `27`, web `18`, ui `9`, db `32`, api `127` passed.
2. `pnpm security` → licence check passed, no leaks; audit shows only the accepted moderate esbuild advisory.
3. With `pnpm dev` running: `pnpm e2e:journey` → `2 passed`; `pnpm e2e` → `6 passed`.
4. By hand: open http://localhost:5173/sign-up, create an account, open the email in Mailpit (http://localhost:8025), sign in, create a company → you land on http://<slug>.localhost:5173 without signing in again → set up two-factor → invite a second email → open that invitation in a private window.

## Known issues
- CI workflow not yet run on GitHub (no remote). Locally the identical steps pass.
- Turborepo sends anonymous usage telemetry by default; opt out with `pnpm turbo telemetry disable` if preferred.
- multer override must be removed once @nestjs/platform-express ships multer ≥ 2.5.0 (check on each NestJS upgrade).
- Identity tables are global by design (decision in `modules/identity.md` §3), protected by module ownership + lint, not RLS.
- Arabic email texts are machine-drafted; native-speaker review needed before release.
- Accepted moderate advisory GHSA-67mh-4wv8-2f99 (esbuild dev server, unused) — security.md §2b.
- Right after enabling two-factor, the code just used cannot sign in again (replay protection); wait for the next code.
- Windows PowerShell cannot resolve `*.localhost` company addresses → use `pnpm http` (dev helper) or a browser.
- Cancelling trusted devices (on gaining a sensitive role) also voids an unused password-reset link at that moment.
- Project-scoped checks exist for projects (Phase 5); team-scoped checks and project-scoped reading of clients/contracts arrive with Phases 6–8.
- Light-mode colours `ink-3`, `butter-ink`, `warn` darkened vs. the approved preview for WCAG contrast (design-system.md).
- Font licence texts (OFL) must ship in THIRD_PARTY_NOTICES before release.
- Web bundle is one file over 500 kB (Vite warning); add route-level code splitting (Phase 2).
- New accounts confirm their email on the main address; to finish joining a company, return to the invitation tab ("Back to sign in") or reopen the invitation email.
- The journey test leaves its `e2e-*` companies and `*@example.test` accounts in the dev database (emails are deleted). Harmless; a dev reset clears them.
- No password-change screen yet (API exists); no audit-log or company-settings screens yet.
- Members table and app frame are not yet tuned for phone width (navigation drawer in Phase 2).
- Dev DB contains rehearsal accounts/companies (`rehearsal-*@example.com`, `rehearsal-*` slugs) from verification runs.
- `erp_platform` is NOLOGIN until platform-operator features are designed.
- Not yet built by design: worker, files, notifications, monitoring, Dockerfiles (1.5).

## Next recommended step
Phase 15b (production configuration guard, deployment smoke test of the production compose with built images, staging profile, headers and rate-limit review, THIRD_PARTY_NOTICES), then 15c and 15d (`hardening.md`), built in nonstop mode. See the newest entry in `session-log.md`.

# Project Status

Last updated: 2026-10-28

## Current phase
Phase 1 — Foundation. Milestone 1.1 approved and committed (`c3d09be`). Milestone 1.2 approved and committed (`097350e`). Milestone 1.3a approved and committed (`253b180`). Milestone 1.3b approved and committed (`4ae3f76`). Milestone 1.4a approved and committed (`b875341`). Milestone 1.4b approved and committed (`f1f9276`). **Milestone 1.5a approved and committed (`511f52e`). Milestone 1.5b (files, monitoring, Dockerfiles) built and committed 2026-10-29 in nonstop mode. **Phase 1 complete.** Phase 2 (2a shell, 2b dashboard) built and committed 2026-10-29. **Next: Phase 3 (Clients / CRM).**** All work is traced against `product-brief.md` in `requirements-checklist.md`; session hand-offs are in `session-log.md`.

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

## Open questions
1. **GRC tooling scope** — deferred (2026-10-24). Build the core ERP (Phases 1–7) first; revisit GRC delivery tooling once the core works. Data model keeps "engagement" central so GRC modules can attach later.
2. **Design pilot** — no firm available yet. Seek feedback from 1–2 audit/GRC practitioners before Phase 5–7.
3. **Legal review** — when available, Kuwaiti counsel for items marked ⚖️ in `compliance.md`.
4. **Platform domain name** — none yet; dev uses `*.localhost` subdomains (no purchase needed until deployment).
5. **Design direction** — v0.2 approved 2026-10-24 (v0.1 rejected as generic). See `design-system.md`.
6. **Trademark** — search for the product name before launch (see `compliance.md` §3).
7. **On-prem object storage** — which S3-compatible product to bundle/recommend; decide before first on-prem customer.
8. **GitHub remote** — needed before the CI workflow can actually run on GitHub.
9. **Expenses module** — included by default as Phase 12b (owner said "do whatever"); scope confirmed at phase start.

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
- Role checks are company-wide for now; team/project-scoped resource checks arrive with those modules.
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
Phase 3 (Clients / CRM), built in nonstop mode: spec `docs/modules/clients.md` first. See the newest entry in `session-log.md`.

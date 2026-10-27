# Project Status

Last updated: 2026-10-24

## Current phase
Phase 1 — Foundation. Milestone 1.1 approved and committed (`c3d09be`). Milestone 1.2 approved and committed (`097350e`). **Milestone 1.3a (identity) tested by the owner and approved 2026-10-27.** Next: Milestone 1.3b plan awaiting owner decisions. All work is traced against `product-brief.md` in `requirements-checklist.md`; session hand-offs are in `session-log.md`.

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

## How to verify Milestone 1.3a
1. `pnpm check` → i18n `4 passed`, contracts `5 passed`, db `32 passed`, api `90 passed`.
2. `pnpm security` → `Severity: 1 moderate` (accepted, see security.md §2b), `Licence check passed`, `no leaks found`.
3. `pnpm dev`, then the PowerShell walkthrough in the newest `session-log.md` entry (sign-up → email in http://localhost:8025 → verify → sign-in → me → sessions → sign-out).

## Known issues
- CI workflow not yet run on GitHub (no remote). Locally the identical steps pass.
- Turborepo sends anonymous usage telemetry by default; opt out with `pnpm turbo telemetry disable` if preferred.
- multer override must be removed once @nestjs/platform-express ships multer ≥ 2.5.0 (check on each NestJS upgrade).
- Identity tables are global by design (decision in `modules/identity.md` §3), protected by module ownership + lint, not RLS.
- Emails are sent synchronously (no retry yet) → Milestone 1.5 outbox.
- Arabic email texts are machine-drafted; native-speaker review needed before release.
- Accepted moderate advisory GHSA-67mh-4wv8-2f99 (esbuild dev server, unused) — security.md §2b.
- Right after enabling two-factor, the code just used cannot sign in again (replay protection); wait for the next code.
- `erp_platform` is NOLOGIN until platform-operator features are designed.
- Not yet built by design: login/RBAC/audit (1.3), web app (1.4), worker, files, notifications, monitoring, Dockerfiles (1.5).

## Next recommended step
Owner verifies Milestone 1.3a and approves (and says whether to commit) → Milestone 1.3b (onboarding, invitations, RBAC + scopes, MFA enforcement for sensitive roles, audit log, OpenAPI). See the newest entry in `session-log.md`.

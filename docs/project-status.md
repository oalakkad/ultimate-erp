# Project Status

Last updated: 2026-10-24

## Current phase
Phase 1 — Foundation. **Milestone 1.1 (skeleton) + follow-up built and verified locally, awaiting owner approval.** All work is traced against the product brief in `requirements-checklist.md`.

## Confirmed decisions
- Jurisdiction: Kuwait. Currency: KWD (3 decimals).
- Languages: English + Arabic, user-switchable, full RTL.
- Business model: multi-tenant SaaS from day one; the founder does not operate a company of their own (no pilot tenant yet).
- Hosting: vendor cloud or customer on-premises — same codebase.
- Target market: audit, risk & GRC firms first, generic professional services next.
- Repository: `C:\dev\ultimate-erp` (outside OneDrive), git initialized locally. Git identity (repo-local): `omar alakkad`. GitHub remote to be added.
- Tooling versions pinned at 1.1 (see ADR-0002 amendments): TypeScript 6.0.3 (not 7 — lint tooling unsupported), NestJS 12 (ESM), pnpm 12, PostgreSQL 18.6.
- Local object storage: RustFS replaces MinIO (MinIO no longer publishes images). ADR-0002 amendment.

## Open questions
1. **GRC tooling scope** — deferred (2026-10-24). Build the core ERP (Phases 1–7) first; revisit GRC delivery tooling once the core works. Data model keeps "engagement" central so GRC modules can attach later.
2. **Design pilot** — no firm available yet. Seek feedback from 1–2 audit/GRC practitioners before Phase 5–7.
3. **Legal review** — when available, Kuwaiti counsel for items marked ⚖️ in `compliance.md`.
4. **Platform domain name** — none yet; dev uses `*.localhost` subdomains (no purchase needed until deployment).
5. **Design direction** — v0.2 approved 2026-10-24 (v0.1 rejected as generic). See `design-system.md`.
6. **Trademark** — search for the product name before launch (see `compliance.md` §3).
7. **On-prem object storage** — which S3-compatible product to bundle/recommend; decide before first on-prem customer.
8. **GitHub remote** — needed before the CI workflow can actually run on GitHub.
9. **Product brief text** — the pasted brief was truncated at §21; owner to send the remainder and ideally save the full original as `docs/product-brief.md`.
10. **Expenses module** — included by default as Phase 12b (owner said "do whatever"); scope confirmed at phase start.

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

## Known issues
- CI workflow not yet run on GitHub (no remote). Locally the identical steps pass.
- Turborepo sends anonymous usage telemetry by default; opt out with `pnpm turbo telemetry disable` if preferred.
- multer override must be removed once @nestjs/platform-express ships multer ≥ 2.5.0 (check on each NestJS upgrade).
- Not in 1.1 by design: web app (1.4), worker, files, notifications, monitoring, Dockerfiles (1.5).

## Next recommended step
Owner verifies Milestone 1.1 (steps in the 1.1 hand-over) and approves → Milestone 1.2 (Tenancy & isolation: Drizzle, migrations, DB roles, RLS, `withTenant`, cross-tenant tests).

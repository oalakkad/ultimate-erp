# Session Log

Hand-off notes between working sessions. **Newest entry first.** Every session ends by adding an entry; every session starts by reading the newest entry, then `project-status.md` and `requirements-checklist.md`.

Each entry: date · what was done · state of the repo (commits, uncommitted work, running services) · verification results (real numbers) · decisions made · open items / waiting on owner · exact next step.

---

## 2026-10-25 — Session 2: owner re-verification of Milestone 1.2

### Where we finished
Milestone 1.2 still **awaiting owner approval**, uncommitted. No code changes this session.

### Done
- Re-ran verification for the owner. First attempt: db tests "31 skipped" because **Docker Desktop was not running** after a restart (not a code problem). Started Docker, re-ran: `pnpm check` **80 passed** (5 + 31 + 44), `pnpm security` clean (no vulnerabilities, 124 packages licence-OK, no leaks).
- Gave the owner a step-by-step self-check (pnpm check, pnpm security, db:seed + dev, browser URLs, `curl.exe` spoof test, verbose isolation tests).

- **Owner hit a bug following my steps:** `pnpm db:seed` failed with `ECONNREFUSED 127.0.0.1:5432` — after the Docker restart the dev containers were stopped (tests passed because they use their own containers), and my steps ran the seed before anything started the services. Fixed:
  - `infra/compose/compose.dev.yaml`: `restart: unless-stopped` on all three services (verified in `docker inspect`).
  - `pnpm db:seed` now runs `services:up` → `db:setup` → seed; `services:up` runs `init-env` itself; `pnpm dev` simplified accordingly.
  - New `packages/db/src/cli/run.ts`: CLI commands print one plain sentence for known problems (DB unreachable, bad password, missing DB/tables) instead of a stack trace. Verified with services stopped.
  - Re-verified: owner's exact command `pnpm db:seed` in PowerShell from stopped containers → services started, roles, migrations, both demo tenants, exit 0. `pnpm check` 80 passed; `pnpm security` clean.

### Notes for next session
- On Windows PowerShell `curl` is an alias for Invoke-WebRequest; tell the owner to use `curl.exe`.
- If tests show "skipped" or Docker connection errors, check Docker Desktop first.
- When giving the owner manual steps, run them myself first in PowerShell from a cold state (services stopped).

### Next step
Wait for the owner's result and approval of 1.2 (and whether to commit). Then Milestone 1.3 plan (see Session 1 entry).

---

## 2026-10-24 — Session 1: Phase 0 approval → Milestone 1.1 → brief review → Milestone 1.2

### Where we finished
**Milestone 1.2 (Tenancy & isolation) is built and verified, awaiting the owner's review and approval.** Do not start Milestone 1.3 until the owner approves 1.2 (brief §3 Rule 1, §22).

### Done this session
1. **Milestone 1.1 — Skeleton** (approved by owner, committed `c3d09be`): pnpm 12 + Turborepo monorepo, TypeScript 6.0.3 strict, ESLint/Prettier, Vitest; Docker Compose (Postgres 18.6, RustFS, Mailpit); NestJS 12 API with validated config, redacted Pino logs, correlation IDs, standard errors, Helmet, CORS allow-list, body limit, `/health` + `/health/live`; CI workflow.
2. **Brief compliance review + follow-up** (in `c3d09be`): CI `security` job (pnpm audit, licence allow-list, gitleaks — verified with a planted token); fixed high CVE in multer via pnpm override; created `requirements-checklist.md`, `testing.md`, `api.md`; evidence register; security/domain/architecture/roadmap gaps filled (Milestone 1.5 added, expenses as Phase 12b).
3. **Owner saved the full brief** as `docs/product-brief.md` (§1–25). Checklist now covers §22–25 too.
4. **Milestone 1.2 — Tenancy & isolation** (NOT committed yet):
   - `packages/db`: Drizzle 0.45.4 schema (`users`, `tenants`, `tenant_domains`, `memberships`), migrations `0000_foundation_tables.sql` (generated) and `0001_foundation_security.sql` (roles' grants, ENABLE+FORCE RLS, policies, `updated_at` triggers, `app.current_tenant_id()`, `app.resolve_tenant_by_host()`), `withTenant`, `assertSafeAppRole`, admin bootstrap/migrate, dev seed, Testcontainers helper.
   - DB roles: `erp_migrator` (owner), `erp_app` (API, no BYPASSRLS), `erp_platform` (NOLOGIN, tenant directory only).
   - API: `TenantDatabase` (only data path), `DatabaseRoleCheck` (refuses superuser/BYPASSRLS → 503), tenancy module (host → tenant middleware on all routes except health, `@CurrentTenant()`, `GET /api/v1/tenant`).
   - Lint: `import-x/no-cycle` (needed `importX.flatConfigs.typescript.settings` — without it the rule silently did nothing) and `no-restricted-imports` for business modules.
   - Docs: new `database.md`; ADR-0003 implementation notes; compliance evidence; testing, api, README, roadmap, checklist updated.

### State of the repo
- Branch `main`. Last commit `c3d09be` (1.1). **All Milestone 1.2 work is uncommitted** — commit after owner approval if they ask ("commit only when the owner asks").
- Owner's local `.env` was updated: `DATABASE_URL` now uses `erp_app`; `DATABASE_MIGRATOR_URL` and `DATABASE_ADMIN_URL` added.
- Docker services (postgres, object-storage, mailpit) were left **running**; dev DB has roles, migrations and the demo tenants `acme` / `globex` seeded. API dev server is stopped.
- No GitHub remote yet, so CI has never run on GitHub.

### Verification (last run, 2026-10-24)
- `pnpm check`: format ✅, lint ✅, typecheck ✅, tests **80 passed** (contracts 5, db 31, api 44), 0 failed.
- `pnpm security`: no known vulnerabilities; licence check passed (124 production packages); gitleaks no leaks.
- Mutation check: replacing the isolation policy with `USING (true)` made 10 isolation tests fail (then restored).
- Live: `acme.localhost:3000/api/v1/tenant` → Acme; `globex.localhost` → Globex; unknown host → 404; `X-Forwarded-Host` spoof ignored; `/health` up.

### Decisions made this session (all recorded in docs)
- TypeScript 6.0.3 not 7 (typescript-eslint support); NestJS 12 ESM; Drizzle stable 0.45 not 1.0-rc; RustFS instead of MinIO (ADR-0002 amendments).
- Expenses module included as Phase 12b (owner: "do whatever").
- `users` is global, no RLS yet — decide row rules with Better Auth in 1.3.
- Companies and memberships are never deleted (status instead).

### Open items / waiting on owner
- **Approve Milestone 1.2** (manual verification steps in the 1.2 hand-over / `project-status.md`).
- Whether to commit 1.2 once approved.
- GitHub remote (so CI runs).
- Legal review items (compliance.md ⚖️), trademark search, platform domain name — not blocking yet.

### Next step (after approval)
Milestone 1.3 — Identity & access: Better Auth ≥ 1.6.11 (verify latest + advisories first), sign-up, email verification via Mailpit, login, TOTP MFA + recovery codes, password reset, sessions list/revoke, remembered devices, rate limits, suspicious-login notices; company onboarding (creates tenant + subdomain + owner membership); invitations (verified email must match); RBAC with permission keys + scopes from `permissions.md`; append-only audit log; OpenAPI generation; strict request validation; decide `users` row rules. Start by writing the 1.3 plan + decisions for the owner (brief §22), and check `requirements-checklist.md` rows tagged 1.3.

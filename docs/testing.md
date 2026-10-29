# Testing Strategy

Status: **Active from Milestone 1.1.** Testing is mandatory: a module is not done until its tests run and pass (see Definition of Done).

## 1. Test levels

| Level | Tool | What it proves | Where |
|---|---|---|---|
| Unit | Vitest | Pure rules: calculations, validation, state transitions, permission decisions, formatting. No DB, no network. | `*.spec.ts` next to the code; `packages/domain` heavily |
| Integration | Vitest + Supertest + Testcontainers (real PostgreSQL 18.6) | HTTP → service → database behaviour, RLS, transactions, rollback, concurrency. **Never a mocked database** — tenant isolation must be exercised for real. | `apps/api/test/` |
| End-to-end | Playwright (from Milestone 1.4) | Real user workflows in the browser, both EN (LTR) and AR (RTL). Emails read from Mailpit. | `e2e/` |
| Accessibility | axe-core in Playwright | WCAG 2.2 AA checks on key screens, both directions. | `e2e/` |
| Security gates | pnpm audit, licence check, gitleaks | No known high/critical vulnerabilities, only approved licences, no committed secrets. | CI `security` job |

Fixtures: test data is created by each test (factories in `test/fixtures/`), never shared mutable seed data, and never used by production code.

## 2. Commands

| Command | Runs |
|---|---|
| `pnpm test` | All unit + integration tests (needs Docker running for Testcontainers) |
| `pnpm --filter @ultimate-erp/api test` | API tests only |
| `pnpm --filter @ultimate-erp/db test` | Database isolation suite only |
| `pnpm --filter @ultimate-erp/api exec vitest run test/http.spec.ts` | One test file |
| `pnpm --filter @ultimate-erp/api exec vitest` | Watch mode while developing |
| `pnpm check` | Format check, lint, typecheck, tests (what CI's `check` job runs) |
| `pnpm security` | Vulnerability audit, licence check, secret scan (what CI's `security` job runs) |
| `pnpm e2e` | Builds, then runs Playwright browser tests (gallery, accessibility, RTL). Screenshots: `apps/web/e2e/screenshots/` |
| `pnpm e2e:journey` | Full first-day journey in EN and AR against the running dev stack — start `pnpm dev` first. Reads real emails from Mailpit, deletes them afterwards (CI `journey` job) |

## 3. Release-blocking suites

1. **Cross-tenant suite** (from Milestone 1.2, extended by every module): for each tenant-owned resource, company B's user attempts read, list, update, delete, search, export, file download, notification read and job processing on company A's records. Every attempt must fail (404, or zero rows).
2. **Permission matrix suite** (from Milestone 1.3): generated from `permissions.md`; every permission key × role × scope combination is asserted allowed/denied at the API.
3. **Security gates**: CI `security` job.

## 4. Required end-to-end workflows → phase

These are the 20 workflows from the product brief. Each becomes a Playwright test in the phase that makes it possible, and stays in the regression suite afterwards.

| # | Workflow | Phase |
|---|---|---|
| 1 | Authorized company administrator logs in securely (incl. MFA) | ✅ 1.4b (`e2e/journey.spec.ts`) |
| 2 | Administrator creates a client | 3 |
| 3 | Administrator creates a contract or engagement letter | 4 |
| 4 | Administrator creates a project for that client | 5 |
| 5 | Administrator sets an approved project budget | 5 |
| 6 | Administrator creates tasks for that project | 6 |
| 7 | Administrator assigns employees and budgeted hours | 6 |
| 8 | System updates remaining project hours correctly (100h → 45 allocated / 55 remaining) | 6 |
| 9 | Employee logs in and sees only authorized tasks | 6 |
| 10 | Employee records actual work hours | 7 |
| 11 | Manager reviews and approves a timesheet | 7 |
| 12 | Project dashboard reflects the updated figures | 7 |
| 13 | Employee submits a leave request | 9 |
| 14 | Authorized manager approves or rejects it | 9 |
| 15 | Attendance is recorded and validated | 10 |
| 16 | Authorized user prepares and approves payroll (different people) | 11 |
| 17 | Authorized user creates an invoice and records a payment | 12 |
| 18 | Notifications are delivered to the correct recipients | ✅ infra + first types 1.5a (`access.spec.ts`, `journey.spec.ts`); 6+ (each module), 13 |
| 19 | Reports reflect the underlying business records | 14 |
| 20 | Unauthorized users are blocked from restricted operations | 1.3 onward, every phase |

## 5. Required negative and security tests → phase

| Test | Phase |
|---|---|
| Employee accessing another employee's private data | 8 |
| Manager accessing an unauthorized project | 5 |
| User accessing another company's records | 1.2 onward (cross-tenant suite) |
| User assigning themselves elevated privileges | 1.3b ✅ |
| Unauthorized user modifying payroll | 11 |
| Duplicate payment or time-entry submissions (idempotency) | 7, 12 |
| Expired or reused OTPs | 1.3a ✅ |
| Invalid session and invitation tokens | ✅ 1.3a / 1.3b |
| Concurrent hour allocations exceeding a budget | 6 |
| Invalid status transitions | 4 onward (every state machine) |
| Invalid or malicious file uploads | 1.5 |
| Failed notification deliveries (retry, status recorded) | 1.5 |
| Database errors and transaction rollback | 1.2 onward |
| Request validation: unknown fields rejected (mass assignment) | 1.3 onward |

## 6. Rules

- Never report a test as passing unless it ran and passed; hand-overs quote the actual counts.
- A bug fix starts with a failing test that reproduces it.
- No arbitrary sleeps in tests; wait for an explicit condition.
- Integration tests use the same Postgres image as development and production.
- Flaky tests are fixed or quarantined with an issue, never silently retried.

## 7. Current status

| Milestone | Tests | Result (last run) |
|---|---|---|
| 1.1 | 5 contracts + 32 API (config, log redaction, error mapping, HTTP behaviour, real-Postgres health) | 37 passed |
| 1.5a | + outbox/worker suite (5, real SMTP outage via a switchable relay), notifications (5), sealer/error-code unit (11), db queue privileges + notification isolation (5); journey checks the bell | 249 unit/integration (api 148, db 37, contracts 27, web 18, i18n 10, ui 9) + 8 browser |
| 1.4b | + hand-off API suite (6), web unit (error translations, open-redirect guard), **full-stack journey** EN + AR (sign up → confirm email → sign in → create company → hand-off → two-factor → invite → colleague joins) with axe on 12 screens per language | 223 unit/integration (api 127, db 32, contracts 27, web 18, i18n 10, ui 9) + 8 browser (6 gallery + 2 journey) |
| 1.4a | + i18n formatting (ICU plurals EN/AR, exact money strings, Kuwait dates), UI component tests (9 incl. logical-CSS guard), **browser tests** (Playwright: gallery EN/AR × light/dark with axe WCAG 2.2 AA, RTL flip, dialog keyboard) | 199 unit/integration + 6 browser |
| 1.3b | + permission model & matrix-vs-docs (22), access suite against Postgres + Mailpit (25: onboarding, MFA block, invitation lifecycle incl. stolen/expired/revoked/reused, no escalation, forced-concurrency last-Owner, cross-company 404, removal, company sign-in policy, trusted devices, audit + pagination + immutability), OpenAPI (3) | 184 passed (i18n 4, contracts 27, db 32, api 121) |
| 1.3a | + identity suite against real Postgres **and real Mailpit** (31: verification, enumeration, validation, breached passwords, lockout, IP limits, fixation, CSRF, new-device notice, sessions incl. idle/absolute expiry, reset single-use/expiry/hashing, password change, 2FA incl. replay, backup codes, trusted device, encrypted secrets) + unit tests (breach checker fail-open, error mapping, log redaction, i18n catalogs) + global-table guard | 134 passed (i18n 4, contracts 5, db 32, api 93 incl. mailer HTML) |
| 1.2 | + 31 db isolation (roles, catalog guard, fail-closed, cross-tenant read/list/update/delete/insert/move/link, rollback, host resolution, platform role, idempotent migrations) + API tenancy (host routing, spoofed headers, client-supplied IDs, unsafe role) | 80 passed (5 + 31 + 44) |

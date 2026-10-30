# Roadmap

Each phase ends with: tests passing, docs updated, demo/manual verification steps, **and your approval** before the next phase starts.

| Phase | Scope | Status |
|---|---|---|
| 0 | Discovery & architecture (this set of docs) | Approved 2026-10-24 |
| 1 | Foundation — split into milestones below | **In progress** — done (1.1–1.5b) |
| 2 | Executive shell & dashboard (honest empty states until modules exist) | Done 2026-10-29 (2a shell, 2b dashboard) |
| 3 | Clients / CRM | Done 2026-10-30 |
| 4 | Contracts & engagement letters (incl. bilingual templates, PDF) | Done 2026-10-30 |
| 5 | Projects / engagements & budgeting | Done 2026-10-30 |
| 6 | Tasks & hour allocation (concurrency-safe) | — |
| 7 | Timesheets & time tracking | — |
| 8 | Employees, teams, invitations | — |
| 9 | Leave management (after Kuwaiti labour rules confirmed) | — |
| 10 | Attendance (rotating signed QR) | — |
| 11 | Payroll (after jurisdiction rules verified) | — |
| 12 | Invoicing & payments | — |
| 12b | Expenses (claims, approvals, re-billing, project cost) — default decision 2026-10-24, scope confirmed at phase start | — |
| 13 | Notifications & announcements (complete) | — |
| 14 | Reports, audit search, analytics | — |
| 15 | Hardening & release prep | — |
| 16 | React Native app | — |
| ? | GRC delivery tooling (risk register, controls, audit programs, findings) | **Decision pending** |

Note: Phase 8 (employees) is a dependency of tasks/timesheets. Phase 1 creates a minimal employee/membership record so Phases 3–7 can assign people; Phase 8 builds the full HR profile on top. Notification infrastructure (in-app + email) is built in Phase 1–2 and *extended* in each module; Phase 13 completes preferences and announcements.

## Phase 1 milestones (proposed)

| Milestone | Delivers | Proven by |
|---|---|---|
| **1.1 Skeleton** | Monorepo (pnpm + Turborepo), TypeScript strict, ESLint/Prettier, Vitest, Docker Compose (Postgres, RustFS (S3), Mailpit), API with health checks, config validation, structured logging, correlation IDs, standard error format, CI workflow. | `pnpm dev` runs everything; `/api/v1/health` reports DB status; tests + lint pass in CI. |
| **1.2 Tenancy & isolation** | Drizzle setup, migrations, DB roles, RLS, `withTenant` helper, tenants/memberships tables, composite FK pattern, host-based tenant resolution. | Automated cross-tenant tests prove company A cannot read/write company B. |
| **1.3a Identity** (split 2026-10-25) | Better Auth 1.7.13: sign-up, email verification (Mailpit), login/logout, password reset, TOTP MFA + recovery codes, sessions list/revoke, idle 30 min / absolute 12 h, remembered device (MFA only, 30 days), rate limits + progressive throttling, breached-password check (configurable for offline on-prem), new-device notice, strict request validation, decide `users` row rules. | Auth integration tests: expired/reused OTP and reset tokens, brute-force throttling, session revoke, session fixation, unverified email blocked. |
| **1.3b Access** | Self-service company onboarding (verified email → company + subdomain + Owner), invitations (verified matching email), RBAC permission keys + scopes from permissions.md, MFA required for sensitive roles, append-only audit log, OpenAPI docs. | Invalid invitation, self-elevation, permission matrix suite, audit immutability. |
| **1.3 Identity & access (original scope, now 1.3a + 1.3b)** | Better Auth: sign-up, email verification, login, TOTP MFA + recovery codes, password reset, sessions list/revoke, rate limits; company onboarding; invitations; RBAC with permission keys + scopes; audit log. | Auth integration tests incl. expired/reused OTP, invalid invitation, self-elevation attempts. |
| **1.4a Design system** (split 2026-10-28) | apps/web (React 19, Vite 8, TanStack Router/Query), packages/ui tokens (light/dark), self-hosted fonts, EN/AR catalogs + RTL switch, core components, loading/empty/error/permission-denied states, component gallery page. | Owner reviews the gallery in both languages and themes; unit tests for components and i18n; lint bans physical CSS. |
| **1.4b Screens & E2E** | Sign-up, verify, sign-in, two-factor (QR) + backup codes, forgot/reset, onboarding, invitation accept, sessions, app shell with only built modules; error codes translated. | Playwright E2E full journey in EN and AR via Mailpit; axe checks. |
| **1.4 Design system & shell (original scope, now 1.4a + 1.4b)** | Tokens (light/dark), fonts, core components, app shell, EN/AR switch with RTL, login/onboarding screens wired to real auth, component preview page. | Playwright E2E: sign up → verify email (Mailpit) → enable MFA → log in, in both languages; axe accessibility checks. |
| **1.5a Jobs & notifications** (split 2026-10-28) | pg-boss worker, transactional outbox, email delivery with retries + status, in-app notifications with bell (spec `modules/platform-jobs.md`). | SMTP-down retry, rollback ⇒ no email, cross-tenant job, encrypted payloads, notification isolation, journey bell check. |
| **1.5b Files, monitoring, packaging** | Files (S3, tenant keys, allow-list + magic bytes + size, ClamAV scan, signed downloads); error monitoring (Sentry protocol, configurable, off by default, PII-scrubbed), OpenTelemetry, slow-request logging; Dockerfiles. | Malicious upload samples, EICAR refused, errors reach monitoring without PII. |
| **1.5 Platform services (original scope, now 1.5a + 1.5b)** | Background worker (pg-boss) + transactional outbox; files module (S3 storage, tenant-prefixed keys, upload allow-list + magic-byte check + size limits, short-lived signed downloads); notification foundation (in-app records + email via SMTP/Mailpit, delivery status, retries); error monitoring (Sentry SDK, PII-scrubbed), OpenTelemetry traces, slow-request logging; Dockerfile for API/worker. | Upload tests incl. malicious samples; failed email delivery is retried and recorded; job carries tenant context (cross-tenant test); errors reach monitoring without PII. |

Also added to milestone scopes: **1.2** adds the lint rule against circular imports between modules (module boundaries start there). **1.3** adds OpenAPI generation, request validation (strict schemas), rate limits, remembered devices and suspicious-login notifications (see `security.md` §2a).

## Phase 2 scope (from the product brief)
Executive dashboard layout, sidebar and navigation, header with global search / command palette (Ctrl K), notification center, user profile and settings, company switcher (for users with several memberships), dashboard cards and chart components, activity feed, quick actions, responsive behaviour, loading / empty / error states. Uses only clearly labelled fixtures until each module exists; metrics show honest empty states instead of invented numbers.

## Module scopes
Each phase starts with a module spec in `docs/modules/<module>.md` (purpose, data, dependencies, permissions, acceptance criteria, test plan) covering every item the product brief lists for that module — e.g. tasks: dependencies, recurring tasks, board / list / calendar views, comments, attachments, workload; clients: communication history and activity timeline. The checklist in `requirements-checklist.md` tracks coverage.

# Requirements Checklist (traceability to the product brief)

Purpose: every requirement in the owner's master project prompt (the "product brief") is listed here with **where it is designed**, **when it is built**, and its **status**. Reviewed at the start and end of every milestone so nothing is lost between sessions.

Status: ✅ done · 🟡 designed / partly built · ⏳ scheduled · ❓ needs owner decision

Last reviewed: 2026-10-28 (after Milestone 1.4a). Source: `docs/product-brief.md` (§1–25, complete).

## §1 Role & §19 Teaching
| Requirement | Where / how | Status |
|---|---|---|
| Act as senior architect/engineer/designer/security/QA/mentor; explain reasoning simply | CLAUDE.md working agreement | 🟡 ongoing |
| Before each feature: purpose, fit, data, dependencies, permissions, acceptance criteria, test plan | CLAUDE.md; module specs in `docs/modules/` | 🟡 ongoing |
| After each feature: 13-point hand-over (what, why, architecture, files, each file's role, frontend↔backend, database, auth/permissions, what could go wrong, how tested, manual test, incomplete, next step) | CLAUDE.md hand-over template | 🟡 ongoing |
| Exact commands with expected output; diagnose real errors | Hand-overs, README, testing.md | 🟡 ongoing |

## §2 Product vision
| Requirement | Where | Status |
|---|---|---|
| Connected modules, consistent data model (client → contract → project → budget → tasks → hours → profitability → invoice → payment → reports) | domain-model.md §1–2 | 🟡 designed |
| Genuine multi-tenancy, not company switching | ADR-0003, architecture §6 | 🟡 designed, built in 1.2 |
| Web first, React Native later | ADR-0001/0002, Phase 16 | 🟡 designed |
| Commercial SaaS + on-prem | ADR-0007 | 🟡 designed |

## §3 Non-negotiable rules
| Requirement | Where | Status |
|---|---|---|
| Incremental, stop for approval after each module | CLAUDE.md, roadmap | 🟡 ongoing |
| Understand before coding (10 steps) | CLAUDE.md | 🟡 ongoing |
| Ask on architecture/security/financial/legal decisions; default the rest | CLAUDE.md, project-status open questions | 🟡 ongoing |
| No fake functionality; honest errors; never claim untested passes | CLAUDE.md, testing.md §6 | 🟡 ongoing |
| No silent shortcuts (no bypassed auth/validation, no swallowed exceptions, no arbitrary timeouts) | Code review each milestone | 🟡 ongoing |
| Consistency: inspect before editing, reuse, keep records | project-status.md, this file | 🟡 ongoing |

## §4 Technology selection
| Requirement | Where | Status |
|---|---|---|
| Evaluated stack with reasons and rejected alternatives (all 18 areas) | ADR-0002 | ✅ |
| Versions verified, not assumed | ADR-0002 amendments (TS 6 vs 7, NestJS 12, MinIO → RustFS) | ✅ 1.1 |
| Modular monolith | ADR-0001 | ✅ decided |
| Mobile reuse: API contracts, validation, domain logic outside UI | `packages/contracts`, `packages/domain`, api.md | 🟡 contracts built; domain in 1.2+ |
| Versioned, documented API | api.md (`/api/v1`), OpenAPI | 🟡 conventions done; OpenAPI ⏳ 1.3 |

## §5 UI/UX design
| Requirement | Where | Status |
|---|---|---|
| Premium, distinctive design direction | design-system.md v0.2 (owner-approved vibrant pastel; supersedes the brief's "restrained palette" wording by owner decision) | ✅ direction |
| Tokens: color, type, spacing, radii, shadows, layout, breakpoints, icons | design-system.md §2, packages/ui | ✅ 1.4a |
| Components: buttons … permission-denied states (full list in brief) | modules/web-ui.md §2 | 🟡 core set ✅ 1.4a; tables, pagination, filters, breadcrumbs, date picker, searchable select with their first use |
| Animations with reduced-motion; none on dense/financial data | packages/ui | 🟡 transitions + reduced-motion ✅ 1.4a; richer motion with flows |
| Tables: sort, filter, search, column control, pagination | design-system.md §4, api.md §7 | 🟡 simple members table 1.4b; full data tables ⏳ Phase 3 |
| Command palette / global search | design-system.md §3 (Ctrl K), roadmap Phase 2 | ⏳ Phase 2 |
| Dark mode | packages/ui tokens | ✅ 1.4a |
| Keyboard accessibility, WCAG 2.2 AA | e2e/gallery.spec.ts, e2e/journey.spec.ts | ✅ components 1.4a; every 1.4b screen axe-checked EN/AR (new screens: per module) |
| Contextual help, smart defaults, confirmations for destructive actions | design-system.md §4 | ⏳ per module |

## §6 Multi-tenant architecture
| Requirement | Where | Status |
|---|---|---|
| Per-company profile, branding, domain, settings, data | domain-model.md (tenancy), ADR-0007 | 🟡 profile + domains ✅ 1.2; branding/settings 1.3+ |
| Onboarding workflow (register → owner → domain → verify → branding → invite → roles → live) | modules/access.md | 🟡 ✅ 1.3b except branding (company settings, later) and custom domains |
| Email domain is not proof of membership; invitations + domain verification (TXT) | modules/access.md | ✅ invitations 1.3b; TXT verification with custom domains later |
| Server-side isolation: RLS, composite FKs, never trust client company ID | ADR-0003, docs/database.md | ✅ 1.2 |
| Isolation across API, URLs, jobs, files, search, reports, exports, notifications, real-time, queries | ADR-0003 §7, security.md §2a | 🟡 API + queries ✅ 1.2; others with their features |
| Automated cross-tenant tests, release-blocking | testing.md §3, `packages/db/test/isolation.spec.ts`, `apps/api/test/tenancy.spec.ts` | ✅ 1.2 (extended per module) |

## §7 Roles & access control
| Requirement | Where | Status |
|---|---|---|
| CEO, Manager, Team Leader, Employee, Technical Admin, Platform Operator distinguished; no unrestricted "Super Admin" | permissions.md §2 | ✅ designed |
| RBAC with permission keys + scopes (own/team/project/company), server-side | permissions.md, modules/access.md | ✅ 1.3b (team/project resource checks with those modules) |
| Separation of duties, least privilege, auditable permission changes, session revocation | modules/access.md, modules/identity.md | ✅ 1.3a/1.3b |
| Technical admin has no business-data access | permissions.md, security.md R14 | ✅ designed |

## §8 Authentication & security
| Requirement | Where | Status |
|---|---|---|
| Established auth framework (Better Auth 1.7.13), no homemade OTP | ADR-0004, modules/identity.md | ✅ 1.3a |
| Email verification, MFA (TOTP), recovery codes, password reset | modules/identity.md | ✅ 1.3a (email-OTP sign-in deliberately not enabled, ADR-0004 amendment) |
| Sessions: expiry, logout one/all, remembered devices | modules/identity.md | ✅ 1.3a (no remembered device for sensitive roles: 1.3b) |
| Rate limiting, credential stuffing, progressive throttling, suspicious login | modules/identity.md | ✅ 1.3a |
| Secure invitation acceptance | modules/access.md | ✅ 1.3b |
| Defences: access control, SQLi, XSS, CSRF, SSRF, IDOR, session fixation, brute force, mass assignment, uploads, data exposure, reset, CORS, secrets, dependencies | security.md R1–R15, §2a | 🟡 CORS, secrets, deps, headers, error leakage ✅ 1.1; rest scheduled |
| Security headers, no stack traces | bootstrap.ts | ✅ 1.1 |
| Restricted financial/employee data, signed short-lived downloads, no sensitive logging | security.md §3, R8, R9 | ✅ log redaction 1.1; signed 5-minute attachment downloads, private bucket, uploader-only access 1.5b (record-level rules per module) |
| Retention, backup, deletion, access policies | domain-model.md §5, compliance.md | 🟡 deletion policy ✅; retention ❓ legal input |

## §9 Standards & compliance
| Requirement | Where | Status |
|---|---|---|
| ISO 27001/27002/27701, OWASP ASVS/Top 10, WCAG 2.2 AA as targets, not claims | compliance.md §1 | ✅ |
| Security checklist + compliance evidence register (implemented/partial/outstanding) | compliance.md §4 | 🟡 started 1.1 |
| Kuwait-specific requirements flagged for legal review | compliance.md §2 | ✅ flagged; ❓ legal review |

## §10 Core modules
| Module | Phase | Status |
|---|---|---|
| A Executive dashboard (real data, filters, drill-down, honest empty states; per-module dashboards) | 2, then each module, 14 | 🟡 2b: layout, real-data cards by permission, activity feed, quick actions, charts; filters + module cards + drill-down arrive with each module |
| B Clients / CRM (contacts, communication history, notes, attachments, related records, timeline, dedupe, export) | 3 | ⏳ domain-model §2, §6 |
| C Contracts & engagement letters (templates, numbering, states, versions, renewals, approvals, e-signature integration) | 4 | ⏳ |
| D Projects & budgeting (billing methods, budget revisions, limits & warnings) | 5 | ⏳ |
| E Tasks & time (lifecycle, dependencies, recurring, board/list/calendar, allocation workflow steps 1–12, concurrency-safe) | 6 | ⏳ domain-model §3 |
| F Timesheets & performance (timers, approvals, billable, overtime, utilization, profitability) | 7 | ⏳ |
| G Employees & teams (profiles, hierarchy, documents, restricted personal data, on/offboarding) | 8 (minimal record in 1.3) | ⏳ |
| H Leave (configurable policies, ledger balances, approvals, calendar) | 9 — after Kuwaiti labour rules confirmed | ⏳ ❓ legal |
| I Attendance (rotating signed QR, corrections, shifts, disputes) | 10 | ⏳ |
| J Payroll (versioned rules, no invented formulas, SoD, payslips) | 11 — after jurisdiction rules verified | ⏳ ❓ legal |
| K Invoicing & payments (states, PDF, partial payments, credit notes, aging, decimal money) | 12 | ⏳ |
| Expenses ("if implemented" in brief) | 12b — default: included | ⏳ |
| L Notifications & announcements | infra 1.5a, per module, complete 13 | 🟡 in-app + email with retries, read/unread, deep links, cap + audit ✅ 1.5a; preferences + announcements ⏳ 13 |
| M Reports & analytics | 14 | ⏳ |
| N Audit logs & administration | audit log ✅ 1.3b; search 14 | 🟡 |

## §11 Module connections
| Requirement | Where | Status |
|---|---|---|
| Documented domain model + relationship diagram, data ownership | domain-model.md §1–2 | ✅ draft |
| Transactions, idempotency, explicit state transitions, server-side truth, no circular deps | domain-model §3–4, api.md §8, eslint import-x/no-cycle | 🟡 transactions + no-cycle lint ✅ 1.2; rest per module |
| Domain events / jobs only where useful | architecture §2 (outbox), roadmap 1.5 | ✅ 1.5a (pg-boss, transactional outbox) |

## §12 Architecture & files
| Requirement | Where | Status |
|---|---|---|
| Clean structure separating entry points, UI, features, domain, services, controllers, DB, validation, auth, jobs, files, config, logging, tests, docs | architecture.md §4 | 🟡 skeleton ✅ 1.1 |
| ADRs for significant decisions | docs/decisions/ | ✅ |
| README with setup, env, dev, test, migrations, deployment | README.md, docs/database.md | 🟡 setup/dev/test/migrations ✅; deployment 15 |
| `.env.example` placeholders only | .env.example | ✅ 1.1 |
| Separate dev / test / staging / production config | architecture §7a | 🟡 dev/test ✅; staging ⏳ 15 |

## §13 Database design
| Requirement | Where | Status |
|---|---|---|
| Keys, tenant ownership, integrity, unique constraints, indexes, naming | domain-model.md conventions, docs/database.md §4 | ✅ pattern 1.2 |
| Money precision, date/time handling | ADR-0005 | ✅ decided |
| Timestamps, soft delete only where justified, history | domain-model §5 | ✅ policy |
| Migrations, backup & recovery plan | docs/database.md, ADR-0007 | 🟡 migrations ✅ 1.2; backup ⏳ 15 |
| Concurrency (locking, optimistic versions) | domain-model §3, api.md §8 | 🟡 designed |
| Derived totals consistency | domain-model (ledger for leave; computed hours) | 🟡 per module |

## §14 API & backend
| Requirement | Where | Status |
|---|---|---|
| Consistent conventions, error codes, request tracing, structured logging, versioning | api.md, 1.1 code | ✅ 1.1 |
| Validated schemas, pagination, filtering, sorting, rate limits, idempotency, API docs | api.md §5–9 | 🟡 validation, rate limits, OpenAPI, cursor pagination (audit) ✅; filtering/sorting/idempotency Phase 3+ |
| Auth middleware, authorization policies, tenant-scoped access | ADR-0003/0004, permissions.md | ✅ 1.2 / 1.3a / 1.3b |
| Safe file handling, background processing | roadmap 1.5 | ✅ background processing 1.5a; uploads: allow-list by content, size limit, ClamAV scan, tenant-prefixed keys 1.5b |

## §15 Performance
| Requirement | Where | Status |
|---|---|---|
| Measurable targets, profiling before optimizing | architecture §7b | 🟡 provisional targets |
| Pagination, indexes, code splitting, lazy loading, background jobs, request cancellation, slow-request monitoring | api.md §7, architecture §7b, roadmap 1.5 | 🟡 cursor pagination 1.3b, background jobs 1.5a, slow-request log 1.5b; code splitting Phase 2 |
| Desktop / tablet / mobile web layouts | design-system (breakpoints 1.4a) | ✅ desktop + tablet; phone navigation drawer 2a (journey checks it with axe) |

## §16 Testing
| Requirement | Where | Status |
|---|---|---|
| Unit, integration, E2E strategy | testing.md §1 | ✅ unit + integration 1.1; E2E 1.4a/1.4b (full-stack journey in CI) |
| 20 required E2E workflows mapped to phases | testing.md §4 | ✅ mapped |
| Negative & security tests mapped | testing.md §5 | ✅ mapped |
| Definition of done | CLAUDE.md, this file | ✅ |

## §17 Errors & observability
| Requirement | Where | Status |
|---|---|---|
| Consistent errors, safe logging, correlation IDs, health + DB health, graceful dependency failure | 1.1 code, api.md §3–4 | ✅ 1.1 |
| User-friendly (translated) error messages | ADR-0006, error codes, apps/web/src/lib/errors.ts | ✅ 1.4b (every code EN/AR, unit-tested; request reference shown) |
| Error monitoring, job-failure monitoring, retries, alerting | roadmap 1.5 | 🟡 retries + recorded failures 1.5a; error reports (Sentry protocol, off by default, scrubbed) incl. final job failures 1.5b; alert rules live in the monitoring tool; traces Phase 15 |
| Never blindly retry non-idempotent financial operations | api.md §8 | ✅ rule |

## §18 Development workflow (phases 0–16)
| Requirement | Where | Status |
|---|---|---|
| Phase 0 discovery & architecture | docs/ | ✅ approved 2026-10-24 |
| Phase 1 foundation (setup, config, lint, types, tests, DB, migrations, auth, tenants, authz, errors, logging, tokens, components, layout, navigation, docs) | roadmap 1.1–1.5 | 🟡 1.1 ✅, 1.2 built |
| Phases 2–16 in the brief's order | roadmap.md | ⏳ |

## §20 Workspace management
| Requirement | Where | Status |
|---|---|---|
| Inspect before editing, focused changes, no duplicates, update tests + docs together, run format/lint/types/tests | CLAUDE.md, `pnpm check` | 🟡 ongoing |
| Summarize modified files after each milestone | Hand-over | 🟡 ongoing |
| Project notes + implementation checklist to resume across sessions | project-status.md, session-log.md, this file | ✅ |

## §21 Documentation
| Document | Status |
|---|---|
| README.md | ✅ |
| docs/architecture.md | ✅ |
| docs/roadmap.md | ✅ |
| docs/domain-model.md | ✅ |
| docs/security.md | ✅ |
| docs/permissions.md | ✅ |
| docs/testing.md | ✅ |
| docs/design-system.md | ✅ |
| docs/api.md | ✅ |
| docs/decisions/ | ✅ ADR-0001..0007 (+ amendments) |
| docs/modules/ | ⏳ one spec per module at phase start |
| docs/compliance.md | ✅ |
| docs/project-status.md | ✅ |
| docs/database.md (added: roles, migrations, table checklist) | ✅ 1.2 |
| docs/session-log.md (added: session-by-session hand-off for the next Claude session) | ✅ |
| Documentation never claims unfinished features are complete | 🟡 ongoing (statuses in this file) |

## §22 Communication & approval
| Requirement | Where | Status |
|---|---|---|
| Before each major module: short plan + decisions needing approval | CLAUDE.md | 🟡 ongoing |
| After each module: A What was built · B Files · C Architecture · D Security · E Testing (real results) · F Manual verification · G Outstanding issues · H Next step | CLAUDE.md hand-over template | 🟡 ongoing |
| Never skip or conceal failing tests; fix and retest on correction; wait for review | CLAUDE.md, testing.md §6 | 🟡 ongoing |

## §23 CEO / Super Admin experience
| Requirement | Where | Status |
|---|---|---|
| Premium from first usable version; coherent single view | design-system.md, roadmap Phase 2 | ⏳ 2 |
| Navigation hierarchy: overview, clients, contracts, projects & budgets, tasks & allocation, team, timesheets, leave, attendance, payroll, invoicing, notifications, reports, audit, settings, security | roadmap Phase 2 scope | ⏳ 2 |
| Nav groups, collapsible sections, breadcrumbs, contextual actions, command palette | design-system.md §3, roadmap Phase 2 | ✅ nav groups 1.4a/1.4b; breadcrumbs, command palette (Ctrl K), contextual actions 2a; collapsible sections when the nav grows |
| Every metric drills down to records (permission-aware) | roadmap Phase 2 | ⏳ 2 |
| Answers: what's happening, projects at risk / over budget, over/under-utilized people, overdue tasks, hours remaining, outstanding invoices, expiring contracts, pending leave, issues needing attention | roadmap Phase 2 + module dashboards | 🟡 "what's happening" (activity) ✅ 2b; the rest with their modules (3 → 14) |
| Not overcrowded; payroll hidden without permission | design-system.md §4, permissions.md | ⏳ 2 |

## §24 Final acceptance criteria
| Criterion | Status |
|---|---|
| Premium coherent UI, reusable components | 🟡 design system ✅ 1.4a; screens 1.4b–2b; charts 2b; each module adds its own |
| Secure auth + MFA | ✅ 1.3a + 1.3b |
| Reliable tenant isolation | 🟡 foundation ✅ 1.2, extended per module |
| Server-enforced authorization; business vs technical admin separated | ✅ 1.3b (foundation; each module adds its checks) |
| Correct record relationships; accurate budgets/allocations; planned vs actual hours | ⏳ 3–7 |
| Reliable leave & attendance; verified payroll for jurisdiction | ⏳ 9–11 (❓ legal) |
| Reliable invoices/payments; centralized secure notifications; module dashboards; audit history | ⏳ 12–14 |
| Automated unit, integration, security, E2E tests | ✅ unit/integration/security; E2E journey 1.4b (grows per phase) |
| Organized code & docs; reproducible setup & deployment | 🟡 setup ✅; deployment 15 |
| Documented security & compliance assessment | 🟡 security.md + compliance.md ongoing |
| Ready for React Native client | 🟡 shared contracts ✅ |
| Production readiness shown by evidence | ⏳ 15 |

## §25 First task (Phase 0)
| Requirement | Status |
|---|---|
| Assessment, stack, architecture, tenancy model, DB design, roles, design direction, structure, roadmap, risks; essential questions only; wait for approval | ✅ Phase 0, approved 2026-10-24 |

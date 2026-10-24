# System Architecture

Status: **Draft — Phase 0, awaiting approval**
Last updated: 2026-10-24

## 1. Product context (confirmed decisions)

| Decision | Answer | Architectural consequence |
|---|---|---|
| Initial jurisdiction | Kuwait | Default currency KWD (3 decimals), timezone `Asia/Kuwait`, work week Sun–Thu (configurable), Kuwait-specific compliance review (see `compliance.md`). |
| Languages | English + Arabic, user-switchable | Full RTL support from day one; bilingual business data fields where needed (e.g. client legal name EN/AR). |
| Business model | Multi-tenant SaaS from the first release | Real tenant isolation, self-service company onboarding, platform-operator role. |
| Hosting | Vendor cloud (SaaS) **or** customer on-premises | Everything must run from our own container images. No hard dependency on a proprietary managed service (auth, queue, storage, email must all be swappable/self-hostable). |
| Target customers | Audit, risk & GRC firms first; generic professional services next | "Project" is configurable to display as "Engagement"; engagement letters, hour budgets and timesheets are core, not optional. |

## 2. Architectural style: modular monolith

One deployable backend, internally split into **modules with hard boundaries**.

Why not microservices: they add network failure modes, distributed transactions and operational cost. An ERP needs many cross-module transactions (e.g. "create task + allocations + notify" must succeed or fail together). A modular monolith keeps those as ordinary database transactions while still letting us extract a module later if real scale demands it.

Module rules:
- A module owns its tables. Other modules never write to them directly — they call the owning module's service (public interface).
- Modules communicate through (a) direct service calls for synchronous needs and (b) domain events written to an outbox table for side-effects (notifications, dashboard refresh, audit fan-out).
- Dependency direction is enforced by lint rules (no circular imports between modules).

## 3. High-level components

```
            ┌──────────────┐      ┌───────────────┐
 Browser ──►│  apps/web    │      │ apps/mobile   │ (Phase 16, Expo)
            │ React SPA    │      │ React Native  │
            └──────┬───────┘      └──────┬────────┘
                   │  HTTPS  /api/v1 (same contract)
            ┌──────▼──────────────────────▼────────┐
            │              apps/api                │
            │  NestJS modular monolith             │
            │  auth · tenancy · access · audit ·   │
            │  clients · contracts · projects ·    │
            │  tasks · time · people · leave ·     │
            │  attendance · payroll · billing ·    │
            │  notifications · files · reports     │
            └──────┬──────────────┬────────────────┘
                   │              │ outbox / jobs
            ┌──────▼─────┐  ┌─────▼──────┐   ┌──────────────┐
            │ PostgreSQL │◄─┤ apps/worker│──►│ SMTP / email │
            │ + RLS      │  │ (pg-boss)  │   └──────────────┘
            └────────────┘  └─────┬──────┘
                                  │
                           ┌──────▼───────────┐
                           │ S3-compatible    │
                           │ object storage   │
                           │ (RustFS / S3)    │
                           └──────────────────┘
```

- **apps/web** — React single-page app. Has *no* business logic of record; it displays and submits. All authoritative calculations (budgets, balances, payroll, permissions) run on the server.
- **apps/api** — HTTP API, authentication, authorization, business rules, transactions.
- **apps/worker** — same codebase, different entry point. Runs background jobs: email delivery, PDF generation, reminders, exports, scheduled checks (contract expiry, overdue invoices).
- **PostgreSQL** — the single source of truth. Job queue (pg-boss) also lives here, so on-prem customers need only Postgres + object storage + SMTP.
- **Object storage** — any S3-compatible service. RustFS for local dev (see ADR-0002 amendment); any S3-compatible store on-prem; AWS S3 / equivalent in cloud.

## 4. Repository layout (monorepo)

```
ultimate-erp/
├─ apps/
│  ├─ api/                 NestJS API (HTTP entry point)
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ platform/      cross-cutting: config, logging, errors, request context, health
│  │     ├─ modules/
│  │     │  ├─ identity/   Better Auth integration, sessions, MFA
│  │     │  ├─ tenancy/    companies, domains, memberships, tenant resolution
│  │     │  ├─ access/     roles, permissions, policy checks
│  │     │  ├─ audit/
│  │     │  ├─ clients/ ... (one folder per business module)
│  │     │  │  ├─ clients.controller.ts   HTTP only: parse, call service, map response
│  │     │  │  ├─ clients.service.ts      use-cases, transactions, permission checks
│  │     │  │  ├─ clients.repository.ts   SQL (tenant-scoped)
│  │     │  │  ├─ clients.events.ts
│  │     │  │  └─ clients.*.spec.ts
│  │     └─ worker.ts      worker entry point
│  └─ web/                 React + Vite SPA
│     └─ src/
│        ├─ app/           router, providers, layouts
│        ├─ features/      one folder per module (pages, hooks, feature components)
│        └─ lib/           api client, i18n setup, formatting
├─ packages/
│  ├─ contracts/           Zod request/response schemas, error codes, permission keys — shared by web, api, mobile
│  ├─ domain/              pure business logic (money, hour allocation math, state machines). No framework, no DB. Heavily unit-tested.
│  ├─ db/                  Drizzle schema, migrations, RLS policies, seed scripts
│  ├─ ui/                  design system (tokens + components)
│  ├─ i18n/                EN/AR message catalogs
│  └─ config/              shared tsconfig, eslint, prettier
├─ e2e/                    Playwright end-to-end tests
├─ infra/
│  ├─ docker/              Dockerfiles
│  └─ compose/             docker-compose for dev and on-prem
└─ docs/
```

Why `packages/domain` is separate: hour-allocation rules, invoice state transitions and money math must be identical everywhere and testable without a database. The mobile app may also need to *preview* calculations (the server still re-validates).

## 5. Request lifecycle (how a request is protected)

1. **Rate limit** by IP and by account.
2. **Correlation ID** assigned (or accepted from trusted proxy) and attached to every log line.
3. **Authenticate** — session cookie (web) or bearer token (mobile) validated by the identity module.
4. **Resolve tenant** — from the subdomain (`acme.erp.example.com`) or custom domain. The frontend never chooses the tenant by sending a raw company ID that we trust.
5. **Verify membership** — the user must have an active membership in that tenant. Otherwise `404` (not `403`, to avoid confirming the tenant exists to outsiders where appropriate).
6. **Validate input** with the Zod schema from `packages/contracts`. Unknown fields are rejected (prevents mass assignment).
7. **Authorize** — the service checks a permission like `projects.budget.update` against the user's roles *and* scope (own / team / project / company).
8. **Execute in a tenant-scoped transaction** — `SELECT set_config('app.tenant_id', $1, true)` is set *inside* the transaction (`true` = transaction-local, so the value cannot leak to the next request reusing the pooled connection). PostgreSQL row-level security then filters every query.
9. **Audit + outbox** — audit records and domain events are written in the same transaction, so they exist if and only if the change committed.
10. **Respond** with a consistent shape; errors map to stable error codes, never stack traces.

## 6. Tenant isolation — defence in depth

Isolation does not rely on any single mechanism:

| Layer | Mechanism |
|---|---|
| Routing | Tenant resolved from host, verified against membership. |
| Application | Repositories require a tenant context; there is no "unscoped" query helper available to business modules. |
| Database (RLS) | Every tenant-owned table has `tenant_id NOT NULL` and an RLS policy `tenant_id = current_setting('app.tenant_id')::uuid`. The API connects as a role **without** `BYPASSRLS` and that does not own the tables. If the setting is missing, queries return nothing (fail closed). |
| Relationships | Composite foreign keys `(tenant_id, client_id) → clients(tenant_id, id)` make it *physically impossible* to link a project in company A to a client in company B, even with a bug. |
| Files | Object keys prefixed by tenant; downloads only through short-lived signed URLs issued after an authorization check. |
| Jobs | Every job payload carries `tenant_id`; the worker sets the same transaction-local tenant context before touching data. |
| Search / reports / exports | Run through the same RLS-protected connection. |
| Tests | Automated cross-tenant tests for every module are release-blocking. |

Platform-level operations (e.g. platform operator listing all tenants for support) use a **separate, narrowly scoped database role and code path**, are fully audited, and never expose tenant business data by default.

## 7. Deployment profiles

| Profile | Shape |
|---|---|
| Local dev | Docker Compose: Postgres, RustFS (S3-compatible), Mailpit (fake inbox). API, web and worker run with hot reload. |
| SaaS | Container images on a cloud provider; managed Postgres; S3-compatible storage; transactional email provider; wildcard subdomain + optional custom domains. |
| On-premises | Same images delivered with a Compose bundle (later Helm chart). Customer provides Postgres (or uses bundled), storage, SMTP. Typically a single tenant, but the same isolation code runs. |

Same code, different configuration. No feature may assume internet access to a proprietary service. This matters for audit/GRC clients such as Kuwaiti banks, which may be bound by Central Bank of Kuwait outsourcing and cloud rules that push them to on-prem.

## 7a. Environments

| Environment | Profile | Purpose |
|---|---|---|
| development | dev | Developer machine, Docker Compose services, `.env`. |
| test | dev | Automated tests; each run creates its own throwaway database (Testcontainers). |
| staging | saas | Production-like copy with synthetic data only (never real customer data), used for release verification before production. Set up with the first deployment (Phase 15). |
| production | saas / onprem | Customers. |

Configuration differs only through environment variables, validated at boot. Production refuses dev-only settings (e.g. `APP_PROFILE=dev`, pretty logs).

## 7b. Performance targets (provisional)

Initial targets for a tenant of ~500 employees, ~5,000 projects, ~2 million time entries; re-validated with load tests in Phase 15 and refined after profiling, not guessed optimizations.

| Measure | Target |
|---|---|
| API p95 latency, reads | < 300 ms |
| API p95 latency, writes | < 500 ms |
| Dashboard first meaningful paint (warm) | < 2 s on a typical office connection |
| List endpoints | Always paginated (max 200 per page); every query on tenant tables uses an index leading with `tenant_id` |
| Expensive work (PDFs, exports, bulk emails) | Background jobs, never in the request |

Slow requests (> 1 s) are logged with their correlation ID; monitoring dashboards in Milestone 1.5.

## 7c. Real-time updates

Not used initially; screens refresh on navigation and via TanStack Query revalidation. Server-Sent Events are the candidate for live notifications (Phase 13), subject to the tenant-binding rules in `security.md` §2a.

## 8. Internationalization (EN/AR)

- Every UI string lives in `packages/i18n` catalogs (ICU message format). No hardcoded text.
- `<html dir="rtl" lang="ar">` switches layout direction; all styling uses **logical** properties (`margin-inline-start`, Tailwind `ms-*`/`me-*`, `start-*`/`end-*`) so RTL works without separate stylesheets.
- Directional icons (arrows, chevrons) mirror in RTL; non-directional icons (charts, checkmarks) do not.
- Numbers and money formatted with `Intl.NumberFormat`. Default: Western digits (0-9) in both languages for financial clarity; per-user option for Arabic-Indic digits.
- Dates: Gregorian by default; optional Hijri display alongside for Arabic users. Stored as UTC `timestamptz`; calendar dates (leave days, due dates) stored as `date`.
- Bilingual data: entities that appear on official documents (company, client legal names, addresses, invoice line descriptions, contract templates) have EN and AR fields. Free-text notes stay single-language.
- Emails, PDFs (invoices, payslips, engagement letters) render in the recipient's/document's language with correct Arabic shaping (requires an Arabic-capable PDF engine — validated in Phase 4).

## 9. Key cross-cutting decisions (see ADRs)

- [ADR-0001](decisions/0001-modular-monolith-monorepo.md) — Modular monolith in a TypeScript monorepo
- [ADR-0002](decisions/0002-technology-stack.md) — Technology stack
- [ADR-0003](decisions/0003-tenant-isolation.md) — Tenant isolation with RLS + composite keys
- [ADR-0004](decisions/0004-authentication.md) — Self-hosted authentication with Better Auth
- [ADR-0005](decisions/0005-money-and-time.md) — Money, currency and time representation
- [ADR-0006](decisions/0006-i18n-rtl.md) — Bilingual EN/AR with RTL
- [ADR-0007](decisions/0007-deployment-profiles.md) — SaaS and on-premises from one codebase

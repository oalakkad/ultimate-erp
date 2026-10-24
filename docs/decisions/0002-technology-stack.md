# ADR-0002: Technology stack

- Status: Proposed (exact versions pinned and re-verified at Phase 1 scaffolding)
- Date: 2026-10-24

| Concern | Choice | Reason | Rejected alternatives |
|---|---|---|---|
| Language | TypeScript (strict) | One language for web, API, mobile; type-safe shared contracts. | — |
| Runtime | Node.js LTS | Mature, stable, long support windows; on-prem friendly. Dev machine has Node 24. | Bun/Deno: less proven for long-lived enterprise on-prem installs. |
| Package manager | pnpm workspaces + Turborepo | Fast, strict dependency isolation, cached builds. | npm workspaces: weaker isolation. |
| Web | React + Vite SPA, TanStack Router (type-safe routes), TanStack Query (server state) | App sits behind login — no SEO need. SPA keeps the web app a pure API client, identical to the mobile app's relationship with the backend. | Next.js: server actions/RSC tend to pull business logic into the web tier, which mobile can't reuse; adds a second server to deploy on-prem. |
| API | NestJS | Built-in module system matching our modular monolith, dependency injection (testability), guards/interceptors for auth, tenancy and audit. | Fastify/Hono alone: we'd hand-build the same structure. |
| API contract | REST `/api/v1`, Zod schemas in `packages/contracts`, OpenAPI generated from them | Language-neutral, documentable, easy for mobile and third-party integrations. | tRPC: excellent DX but TS-only and couples clients tightly; GraphQL: authorization per field is harder to get right. |
| Database | PostgreSQL | RLS for tenant isolation, exact `numeric` money, strong transactions, available everywhere incl. on-prem. | MySQL: no RLS. |
| DB access | Drizzle ORM + drizzle-kit migrations | SQL-transparent (we must see exactly what runs for RLS and locking), supports RLS policy definitions, lightweight. | Prisma: heavier, RLS + transaction-local settings are more awkward. |
| Auth | Better Auth (self-hosted library), **≥ 1.6.11** | See ADR-0004. | Clerk/Auth0/WorkOS: proprietary SaaS, blocks on-prem. Keycloak: strong but heavy to operate and theme bilingually; can be added later as an SSO source. |
| Authorization | Own RBAC + scoped policies in `access` module, permission keys shared via contracts | ERP scopes (own/team/project/company) and separation of duties are domain-specific. | CASL/OPA: may adopt internally later if rules grow. |
| Validation | Zod | Same schema validates on client and server. | — |
| UI | Tailwind CSS + our own design tokens, Radix UI primitives (accessibility), our `packages/ui` components | Accessible behaviour for free, full control over the look. | Pre-styled kits (MUI/Ant): generic look, hard to make premium and RTL-perfect. |
| Animation | Motion (framer-motion successor) | Declarative, honors `prefers-reduced-motion`. | — |
| Tables | TanStack Table (+ virtualization) | Headless, handles sorting/filtering/column control at scale. | — |
| Charts | Recharts or visx — decided in Phase 2 after RTL + theming test | — | — |
| Forms | React Hook Form + Zod resolver | Performant, shares schemas. | — |
| Client state | TanStack Query for server data; Zustand only for small UI state | Avoids a global store duplicating server truth. | Redux: unnecessary. |
| Files | S3-compatible API (RustFS for local dev; any S3-compatible store on-prem) | Portable. Signed short-lived URLs. | Local disk: doesn't scale, hard to secure. |
| Jobs | pg-boss (queue in Postgres) + transactional outbox | No Redis needed; jobs commit with the business transaction. | BullMQ/Redis: extra infra for on-prem. Revisit if throughput demands. |
| Email | SMTP abstraction (Mailpit in dev; provider or customer SMTP in prod) | On-prem customers use their own mail server. | — |
| Testing | Vitest (unit/integration), Testcontainers (real Postgres), Supertest (HTTP), Playwright (E2E, incl. RTL screenshots), axe-core (a11y) | Tests run against real Postgres so RLS is actually exercised. | Mocked DB: would not test isolation. |
| Logging / tracing | Pino (structured JSON, redaction), OpenTelemetry | Vendor-neutral; on-prem can ship to their own stack. | — |
| Error monitoring | Sentry SDK (SaaS or self-hosted Sentry/GlitchTip) | Works both deployment profiles. | — |
| Mobile (Phase 16) | Expo / React Native, reusing `contracts`, `domain`, `i18n` and the API client | Same backend & rules. | — |
| Containers | Docker images, Docker Compose (dev, on-prem), Helm later | Same artifacts everywhere. | — |

## Amendments

### 2026-10-24 — Versions pinned at Milestone 1.1
- TypeScript **6.0.3**, not 7.0: typescript-eslint (8.72) supports TypeScript < 6.1 only. Revisit when it supports 7.x.
- NestJS **12.2** (ESM-only), so the whole repo uses ES modules (`"type": "module"`).
- pnpm 12.15, Turborepo 2.11, Vitest 5.0, ESLint 10, Zod 4.6, Pino 10, PostgreSQL 18.6.
- All dependency versions are pinned exactly (`saveExact`), and dependency install scripts are blocked except an explicit allow-list (`allowBuilds` in `pnpm-workspace.yaml`).

### 2026-10-24 — RustFS replaces MinIO for local object storage
- MinIO stopped publishing free community container images in late 2025 (its Docker Hub repository no longer exists), so it can no longer be pulled as a pinned image.
- Local dev uses **RustFS 1.0.3** (Apache-2.0, S3-compatible). Our code talks only to the standard S3 API, so the store stays swappable (AWS S3, Garage, SeaweedFS, or a store the customer already runs).
- On-prem: the storage product to bundle or recommend will be chosen before the first on-prem customer.

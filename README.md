# Ultimate ERP

Multi-tenant, bilingual (English/Arabic) ERP for audit, risk & GRC firms and professional-services companies. Deployable as SaaS or on-premises.

> Status: **Phase 1 — Milestone 1.4a (design system)**. Web app + design system with EN/AR and light/dark (gallery at http://localhost:5173/gallery). Earlier: Database-enforced company isolation, real accounts with two-factor, company onboarding, invitations, roles and permissions, append-only audit log, generated API docs (http://localhost:3000/api/v1/docs/openapi.json). No web screens or business modules yet.

## Prerequisites
- **Node.js 24** (LTS) — `node -v`
- **pnpm 12** — `npm install -g pnpm@12.15.0`, then `pnpm -v`
- **Docker Desktop**, running — `docker info`

## First-time setup
```sh
pnpm install
```

## Everyday commands (run from the repo root)
| Command | What it does |
|---|---|
| `pnpm dev` | Creates `.env` if missing, starts Postgres / object storage / Mailpit in Docker, prepares the database, then runs the API (http://localhost:3000/api/v1), the background worker (sends emails) and the web app (http://localhost:5173) with auto-reload |
| `pnpm test` | Unit + integration tests (integration tests start their own throwaway Postgres in Docker) |
| `pnpm lint` | ESLint (code-quality rules) |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm format` / `pnpm format:check` | Prettier: fix / check formatting |
| `pnpm check` | Format check, lint, typecheck, tests (CI `check` job) |
| `pnpm e2e` | Browser tests (Playwright + axe). First time: `pnpm --filter @ultimate-erp/web exec playwright install chromium` |
| `pnpm e2e:journey` | The whole first-day journey (sign up → company → two-factor → invite) in a real browser, EN and AR. Start `pnpm dev` first |
| `pnpm e2e:mobile` | The mobile app in a browser preview (sign in, two-factor, company, check in, tasks, leave), EN and AR, against the dev stack. Start `pnpm dev` first |
| `pnpm --filter @ultimate-erp/mobile start` | The mobile app in Expo Go or a development build on a phone (same Wi-Fi; see `docs/operations.md` section 8) |
| `pnpm security` | Vulnerability audit, licence check, secret scan (CI `security` job; needs Docker) |
| `pnpm build` | Compile all packages to `dist/` |
| `pnpm services:up` / `services:down` / `services:logs` | Start / stop / follow the Docker services |
| `docker build -f infra/docker/api.Dockerfile -t ultimate-erp-api .` | Production image for the API and worker (web: `infra/docker/web.Dockerfile`); on-prem example in `infra/compose/compose.prod.example.yaml` |
| `pnpm db:setup` | Create database roles + apply migrations (run by `pnpm dev`) |
| `pnpm db:seed` | Starts the services, prepares the database, adds the two demo companies (dev only): http://acme.localhost:3000/api/v1/tenant |
| `pnpm http <METHOD> <url> [key=value ...] [--as <person>]` | Development helper: call the API, including company addresses like `http://acme.localhost:3000` (PowerShell cannot resolve `*.localhost`). Keeps cookies per person in `.dev-cookies/` |
| `pnpm db:generate --name=<what>` | Create a migration from schema changes (see [docs/database.md](docs/database.md)) |
| `pnpm backup` / `pnpm backup:verify <folder>` | Encrypted backup of the development database and files into `backups/`, and its check (see [docs/operations.md](docs/operations.md)) |
| `pnpm backup:restore <folder> --database <name> --bucket <name>` | Restore drill into a side database and bucket (never over existing data) |
| `pnpm deploy:verify` | Builds the images and checks the production setup end to end (HTTPS, headers, full browser journey, backup); see [docs/operations.md](docs/operations.md) §5 |
| `pnpm perf` | Performance test with 2 million time entries (~15 min); results in [docs/performance.md](docs/performance.md) |
| `pnpm notices` | Regenerates `THIRD_PARTY_NOTICES.txt` after dependency changes (`pnpm security` checks it) |

Stop `pnpm dev` with `Ctrl+C`. The Docker services keep running until `pnpm services:down`, and restart automatically with Docker Desktop. If a command says it cannot reach the database, start Docker Desktop, then `pnpm services:up`. Your data is kept in Docker volumes; `docker compose -f infra/compose/compose.dev.yaml --env-file .env down -v` deletes it.

## Local services
| Service | URL | Notes |
|---|---|---|
| Web app | http://localhost:5173 · gallery http://localhost:5173/gallery | Company addresses: http://<slug>.localhost:5173 |
| API | http://127.0.0.1:3000/api/v1/health | Readiness incl. database |
| PostgreSQL 18 | `127.0.0.1:5432` | Credentials in `.env` |
| Object storage (RustFS, S3 API) | http://127.0.0.1:9000 · console http://127.0.0.1:9001 | Keys in `.env` |
| Mailpit (fake inbox) | http://127.0.0.1:8025 | Catches all dev email |
| ClamAV (virus scanner) | `127.0.0.1:3310` | Scans uploads; ready ~1–2 min after start, needs ~1 GB memory |

All ports bind to `127.0.0.1` only. Values in `.env.example` are local throwaway credentials.

## Repository layout
```
apps/api            NestJS API (platform: config, logging, request IDs, errors, database, health, mail, rate limits, validation, audit, openapi; modules: tenancy, identity, access)
apps/web            React web app (Vite, TanStack Router/Query); talks to the API via /api
apps/mobile         Expo / React Native app (Phase 16): attendance scan, notifications, tasks, time, leave
packages/ui         Design system: tokens (light/dark), fonts, components (Tailwind + Radix)
packages/i18n       English/Arabic catalogs (UI + emails), ICU messages, money/date formatting
packages/db         Drizzle schema, SQL migrations, roles/RLS, withTenant, test database helper
packages/contracts  Shared Zod schemas: error format, health responses, header names
packages/config     Shared TypeScript config
infra/compose       Docker Compose for local services
docs/               Architecture, decisions, roadmap, status
```

## Documentation
- [Project status](docs/project-status.md)
- [Roadmap](docs/roadmap.md) · [Requirements checklist](docs/requirements-checklist.md)
- [Testing](docs/testing.md) · [API conventions](docs/api.md) · [Database](docs/database.md) · [Operations runbook](docs/operations.md) · [Readiness](docs/release-readiness.md) · [Performance](docs/performance.md) · [Hardening plan](docs/hardening.md)
- [Product brief](docs/product-brief.md) · [Session log](docs/session-log.md)
- [Architecture](docs/architecture.md) and [decisions](docs/decisions/)
- [Domain model](docs/domain-model.md) · [Security](docs/security.md) · [Permissions](docs/permissions.md) · [Compliance](docs/compliance.md) · [Design system](docs/design-system.md)

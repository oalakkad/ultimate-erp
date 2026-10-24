# Ultimate ERP

Multi-tenant, bilingual (English/Arabic) ERP for audit, risk & GRC firms and professional-services companies. Deployable as SaaS or on-premises.

> Status: **Phase 1 — Milestone 1.1 (skeleton)**. The API has health checks only; no business features yet.

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
| `pnpm dev` | Creates `.env` if missing, starts Postgres / object storage / Mailpit in Docker, then runs the API with auto-reload on http://127.0.0.1:3000/api/v1 |
| `pnpm test` | Unit + integration tests (integration tests start their own throwaway Postgres in Docker) |
| `pnpm lint` | ESLint (code-quality rules) |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm format` / `pnpm format:check` | Prettier: fix / check formatting |
| `pnpm check` | Format check, lint, typecheck, tests (CI `check` job) |
| `pnpm security` | Vulnerability audit, licence check, secret scan (CI `security` job; needs Docker) |
| `pnpm build` | Compile all packages to `dist/` |
| `pnpm services:up` / `services:down` / `services:logs` | Start / stop / follow the Docker services |

Stop `pnpm dev` with `Ctrl+C`. The Docker services keep running until `pnpm services:down`. Your data is kept in Docker volumes; `docker compose -f infra/compose/compose.dev.yaml --env-file .env down -v` deletes it.

## Local services
| Service | URL | Notes |
|---|---|---|
| API | http://127.0.0.1:3000/api/v1/health | Readiness incl. database |
| PostgreSQL 18 | `127.0.0.1:5432` | Credentials in `.env` |
| Object storage (RustFS, S3 API) | http://127.0.0.1:9000 · console http://127.0.0.1:9001 | Keys in `.env` |
| Mailpit (fake inbox) | http://127.0.0.1:8025 | Catches all dev email |

All ports bind to `127.0.0.1` only. Values in `.env.example` are local throwaway credentials.

## Repository layout
```
apps/api            NestJS API (platform: config, logging, request IDs, errors, database, health)
packages/contracts  Shared Zod schemas: error format, health responses, header names
packages/config     Shared TypeScript config
infra/compose       Docker Compose for local services
docs/               Architecture, decisions, roadmap, status
```

## Documentation
- [Project status](docs/project-status.md)
- [Roadmap](docs/roadmap.md) · [Requirements checklist](docs/requirements-checklist.md)
- [Testing](docs/testing.md) · [API conventions](docs/api.md)
- [Architecture](docs/architecture.md) and [decisions](docs/decisions/)
- [Domain model](docs/domain-model.md) · [Security](docs/security.md) · [Permissions](docs/permissions.md) · [Compliance](docs/compliance.md) · [Design system](docs/design-system.md)

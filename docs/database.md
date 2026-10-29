# Database

Status: **Active from Milestone 1.2.** PostgreSQL 18.6. Schema in `packages/db/src/schema/`, migrations in `packages/db/migrations/`.

## 1. Concepts in plain language

- **Migration**: a numbered SQL file that changes the database structure (create a table, add a column). Migrations run in order, once each; the database remembers which ones ran (table `drizzle.__drizzle_migrations`). Never edit a migration that has run anywhere shared — add a new one.
- **Role**: a database account. We use three, so that the account the API uses cannot change the structure or switch off security.
- **Row-level security (RLS)**: the database adds an invisible `WHERE tenant_id = <current company>` to every query on a protected table. Even a buggy query cannot return another company's rows.
- **Tenant context**: the "current company" for one transaction, set by `withTenant`. No context ⇒ protected tables look empty.

## 2. Roles

| Role | Login | Can | Cannot |
|---|---|---|---|
| `erp_migrator` | yes | Own schema `public` and all tables; run migrations; read/write all rows (explicit policy) | Superuser, bypass RLS, create roles/databases |
| `erp_app` | yes | Read/write rows of the **current tenant only**, as granted per table; call `app.resolve_tenant_by_host` | Own anything, create/alter/drop objects, disable RLS, delete tenants or memberships, bypass RLS |
| `erp_platform` | no (until platform-operator code exists) | List the tenant directory (`tenants`) | Read memberships, domains, users or any business data |

The API checks its own role at first use and refuses all data access (503) if it is a superuser, has `BYPASSRLS`, or is not `erp_app` (`assertSafeAppRole`).

## 3. Commands

| Command | Does |
|---|---|
| `pnpm db:setup` | `db:bootstrap` + migrate. Run automatically by `pnpm dev`. Idempotent. |
| `pnpm db:bootstrap` | Creates/updates the three roles (passwords from `DATABASE_MIGRATOR_URL` / `DATABASE_URL`), schema ownership and connect rights. Needs `DATABASE_ADMIN_URL` (dev superuser). |
| `pnpm db:migrate` | Applies pending migrations as `erp_migrator`. |
| `pnpm db:seed` | Starts the Docker services and runs `db:setup` first. **Development fixtures only**: demo companies `acme` and `globex` (names marked "demo") with hosts `acme.localhost` / `globex.localhost`. Refuses unless `NODE_ENV=development` and `APP_PROFILE=dev`. |
| `pnpm db:generate --name=<what>` | Generates a new SQL migration from changes to `packages/db/src/schema/`. |
| `pnpm --filter @ultimate-erp/db generate:custom -- --name=<what>` | Creates an empty SQL migration for security (RLS, grants, functions). |

Production: a DBA runs the bootstrap statements from `packages/db/src/admin.ts` (`bootstrapDatabase`) once with real secrets; deployments run `db:migrate` as a separate step before starting the new version (ADR-0007).

## 4. Adding a tenant-owned table — mandatory checklist

1. Columns: `id` (`idColumn()`), `tenant_id uuid NOT NULL` → `tenants.id`, `timestamps()`, `version` if users edit it.
2. Constraints: `unique (tenant_id, id)`; every reference to another tenant-owned table is a **composite FK** `(tenant_id, x_id) → x(tenant_id, id)`; indexes lead with `tenant_id`.
3. `pnpm db:generate --name=<module>_tables`, review the SQL.
4. Custom migration with: `ENABLE` + `FORCE ROW LEVEL SECURITY`; policy `<table>_isolation TO erp_app USING/WITH CHECK (tenant_id = app.current_tenant_id())`; policy `<table>_migrator TO erp_migrator USING (true) WITH CHECK (true)`; the **minimum** grants for `erp_app`; `updated_at` trigger.
5. Cross-tenant tests for the module (read, list, update, delete, insert-into-other, link-to-other).

The catalog guard test (`packages/db/test/isolation.spec.ts`) fails automatically if any table with a `tenant_id` column is missing RLS, FORCE, an app policy or the `(tenant_id, id)` key — and its expected table list must be updated deliberately.

## 5. Tables (Milestone 1.2)

| Table | Tenant-owned | Notes |
|---|---|---|
| `users` | No (global identity) | One person, many companies. Unique lower(email). RLS decision in Milestone 1.3 with Better Auth. |
| `tenants` | Is the tenant | `slug`, bilingual names, status `active`/`suspended` (never deleted), default locale, timezone `Asia/Kuwait`, currency `KWD`. |
| `tenant_domains` | Yes | Hostnames routing to a tenant; `verified_at` null ⇒ never routes. |
| `memberships` | Yes | User ↔ tenant, status `invited`/`active`/`suspended`/`removed` (never deleted), `invited_by_membership_id` composite FK (same tenant only). |

Functions (schema `app`): `current_tenant_id()`, `set_updated_at()` (trigger), `resolve_tenant_by_host(text)` (security definer: one exact verified host of an active tenant → its id; cannot list).

## Job queue (Milestone 1.5a)
Background jobs live in Postgres schema `pgboss` (pg-boss). The migration runner (`runMigrations`, as `erp_migrator`) installs/upgrades it and creates every queue listed in `packages/db/src/jobs.ts`; `erp_app` gets SELECT/INSERT/UPDATE/DELETE on its rows and nothing else. Adding a queue = add it to `JOB_QUEUES` and run `pnpm db:setup`. The queue is global (no RLS): job payloads hold IDs and encrypted data only, and a job that touches company data must carry its `tenantId` and run inside `withTenant`. New global table `email_deliveries` (delivery status, no content) and tenant table `notifications` (forced RLS, recipient must be a member — composite foreign key).

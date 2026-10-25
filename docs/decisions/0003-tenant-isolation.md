# ADR-0003: Tenant isolation with PostgreSQL RLS and composite keys

- Status: Proposed
- Date: 2026-10-24

## Context
Multiple companies share one SaaS database. A single missing `WHERE tenant_id = ?` in application code must not leak data. On-prem installs are usually single-tenant but run the same code.

## Decision
1. **Shared database, shared schema**, `tenant_id uuid NOT NULL` on every tenant-owned table.
2. **RLS enabled and forced** (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`) on every tenant-owned table, with policy `tenant_id = current_setting('app.tenant_id', true)::uuid` for USING and WITH CHECK.
3. Three database roles:
   - `erp_migrator` — owns tables, runs migrations only.
   - `erp_app` — used by API and worker; no `BYPASSRLS`, not table owner.
   - `erp_platform` — narrowly granted, audited platform-operator code path (tenant directory, billing of tenants), no access to business tables by default.
4. Tenant context set per transaction via `set_config('app.tenant_id', $id, true)`. All tenant data access happens inside such a transaction; a helper `withTenant(tenantId, fn)` is the only way repositories get a DB handle.
5. **Composite unique keys** `(tenant_id, id)` and **composite foreign keys** `(tenant_id, x_id)` so cross-tenant relationships are rejected by the database itself.
6. Tenant resolved server-side from the request host + authenticated membership. Client-supplied company IDs are never trusted.
7. Mandatory cross-tenant test suite per module (read, update, delete, list, search, export, file download, notification, job).

## Consequences
- (+) Fail-closed: no tenant context ⇒ zero rows.
- (+) Bugs in one query can't cross tenants.
- (−) Slight overhead per transaction; every index on tenant tables should lead with `tenant_id`.
- (−) Large enterprise tenants wanting a dedicated database can be served by deploying a separate instance (same code) — no special casing.

## Alternatives
- Schema-per-tenant: migrations multiply with tenant count; rejected.
- Database-per-tenant only: costly for small SaaS tenants; kept as a deployment option, not the default.

## Implementation notes (Milestone 1.2, 2026-10-24)
- Context function `app.current_tenant_id()` = `nullif(current_setting('app.tenant_id', true), '')::uuid`. The `nullif` matters: after a transaction-local setting ends, Postgres leaves `''`, not NULL.
- The migrator is subject to FORCE RLS like everyone else and gets an explicit `USING (true)` policy per table, so its broad access is visible and reviewable rather than implicit.
- Tenant resolution needs a lookup before any context exists: a `SECURITY DEFINER` function `app.resolve_tenant_by_host(text)` answers one exact, verified host of an active tenant. The app cannot list domains or tenants.
- `erp_platform` exists as `NOLOGIN` with read access to `tenants` only, until platform-operator code is designed.
- The API verifies its own role (not superuser, no BYPASSRLS, exactly `erp_app`) before any data access and on `/health`, refusing with 503 otherwise.
- `users` is global (not tenant-owned); its row-level rules are decided with Better Auth in Milestone 1.3.
- Business modules are lint-blocked from importing `pg`, `drizzle-orm/node-postgres` or the raw database tokens; `TenantDatabase.withTenant` is the only path.
- Details and the checklist for new tables: `docs/database.md`.

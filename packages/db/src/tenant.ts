import { sql } from 'drizzle-orm';
import { type Database, type TenantTransaction } from './client.js';
import { DB_ROLES } from './roles.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction where row-level security exposes only `tenantId`'s rows.
 *
 * The tenant is set with `set_config(..., true)`, which is transaction-local: when the
 * transaction ends (commit or rollback) the setting is gone, so a pooled connection can
 * never carry one request's tenant into the next. If `fn` throws, everything rolls back.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) {
    throw new TypeError('withTenant: tenantId must be a UUID');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Looks up which tenant a request host belongs to (exact, verified host of an active tenant).
 * Returns null for anything else. Runs without tenant context via a narrow database function.
 */
export async function resolveTenantByHost(db: Database, hostname: string): Promise<string | null> {
  const result = await db.execute<{ tenant_id: string | null }>(
    sql`select app.resolve_tenant_by_host(${hostname}) as tenant_id`,
  );
  return result.rows[0]?.tenant_id ?? null;
}

export class UnsafeDatabaseRoleError extends Error {
  override readonly name = 'UnsafeDatabaseRoleError';
}

/**
 * Refuses to work when connected as a role that could bypass tenant isolation:
 * a superuser, a role with BYPASSRLS, or a role other than the dedicated app role.
 */
export async function assertSafeAppRole(db: Database): Promise<void> {
  const result = await db.execute<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
    sql`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
  );
  const role = result.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.rolname !== DB_ROLES.app) {
    throw new UnsafeDatabaseRoleError(
      `Database role must be "${DB_ROLES.app}" without superuser or BYPASSRLS ` +
        `(connected as "${role?.rolname ?? 'unknown'}").`,
    );
  }
}

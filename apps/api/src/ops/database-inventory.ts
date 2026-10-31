import { MIGRATIONS_FOLDER } from '@ultimate-erp/db/admin';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type pg from 'pg';

/**
 * What a backup records about the database and what a restore checks (docs/operations.md §2).
 * Everything here reads the system catalogue or counts rows; nothing changes data.
 */

const USER_SCHEMAS = `n.nspname not in ('pg_catalog', 'information_schema')
  and not starts_with(n.nspname, 'pg_toast') and not starts_with(n.nspname, 'pg_temp')`;

/** Every table holding rows (partitions included), as "schema.table". */
export async function listTables(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select n.nspname || '.' || c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and ${USER_SCHEMAS}
      order by 1`,
  );
  return rows.map((r) => r.name);
}

/** Exact row count of every table, in the caller's snapshot. */
export async function countRows(
  client: pg.ClientBase,
  tables: readonly string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [schema, name] = table.split('.') as [string, string];
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from ${client.escapeIdentifier(schema)}.${client.escapeIdentifier(name)}`,
    );
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

/**
 * Tables with row-level security whose rows the current role might not all see: no permissive
 * read policy `USING (true)` for it, or a restrictive policy that applies to it. A backup made
 * as the migrator would silently miss rows of such a table, so the backup refuses instead.
 */
export async function partlyReadableTables(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `with me as (select oid from pg_roles where rolname = current_user)
     select c.oid::regclass::text as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and c.relrowsecurity and ${USER_SCHEMAS}
        and (
          not exists (
            select 1 from pg_policy p
             where p.polrelid = c.oid and p.polpermissive and p.polcmd in ('r', '*')
               and (p.polroles = '{0}' or (select oid from me) = any (p.polroles))
               and pg_get_expr(p.polqual, p.polrelid) = 'true')
          or exists (
            select 1 from pg_policy p
             where p.polrelid = c.oid and not p.polpermissive and p.polcmd in ('r', '*')
               and (p.polroles = '{0}' or (select oid from me) = any (p.polroles)))
        )
      order by 1`,
  );
  return rows.map((r) => r.name);
}

/** Tables whose row-level security is enabled and forced (recorded; must survive a restore). */
export async function forcedRlsTables(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select n.nspname || '.' || c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity and ${USER_SCHEMAS}
      order by 1`,
  );
  return rows.map((r) => r.name);
}

/** Company-owned tables (a tenant_id column) that are not protected by forced RLS. */
export async function unprotectedTenantTables(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select c.relname as name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
        and not (c.relrowsecurity and c.relforcerowsecurity)
      order by 1`,
  );
  return rows.map((r) => r.name);
}

export interface MigrationLevel {
  /** Number of applied migrations. */
  count: number;
  /** Hashes of the applied migrations, oldest first. */
  hashes: string[];
  /** created_at of the newest applied migration (drizzle's ordering key). */
  latest: number;
}

export async function appliedMigrations(client: pg.ClientBase): Promise<MigrationLevel> {
  const { rows } = await client.query<{ hash: string; created_at: string }>(
    'select hash, created_at from drizzle.__drizzle_migrations order by created_at, id',
  );
  return {
    count: rows.length,
    hashes: rows.map((r) => r.hash),
    latest: rows.length > 0 ? Number(rows[rows.length - 1]?.created_at) : 0,
  };
}

/** The migrations this version of the software knows. */
export function knownMigrations(): MigrationLevel {
  const files = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  return {
    count: files.length,
    hashes: files.map((f) => f.hash),
    latest: files.length > 0 ? (files[files.length - 1]?.folderMillis ?? 0) : 0,
  };
}

/**
 * Why a backup cannot be restored by this version (newer, or from a different history), or
 * undefined when it can. Older backups are fine: the restore brings them up to date.
 */
export function migrationProblem(
  backup: MigrationLevel,
  known: MigrationLevel,
): string | undefined {
  if (backup.latest > known.latest || backup.count > known.count) {
    return 'The backup was made by a newer version of Ultimate ERP. Restore it with that version or a later one.';
  }
  const knownHashes = new Set(known.hashes);
  if (backup.hashes.some((h) => !knownHashes.has(h))) {
    return 'The backup contains database changes this version does not recognise. Restore it with the version that made it.';
  }
  return undefined;
}

/** True when the database has no tables, functions or schemas of its own (a safe restore target). */
export async function isEmptyDatabase(client: pg.ClientBase): Promise<boolean> {
  const { rows } = await client.query<{ objects: string; schemas: string }>(
    `select
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where ${USER_SCHEMAS}) +
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where ${USER_SCHEMAS}) as objects,
       (select count(*) from pg_namespace n
         where ${USER_SCHEMAS} and n.nspname <> 'public') as schemas`,
  );
  const row = rows[0];
  return Number(row?.objects ?? 1) === 0 && Number(row?.schemas ?? 1) === 0;
}

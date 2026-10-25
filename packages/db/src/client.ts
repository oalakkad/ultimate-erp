import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

/** A transaction handle scoped to exactly one tenant (see `withTenant`). */
export type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

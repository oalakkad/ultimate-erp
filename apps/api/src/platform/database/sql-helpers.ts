import { type AnyColumn, sql, type SQL } from 'drizzle-orm';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `column = any($1::uuid[])`: ONE parameter however long the list. `IN ($1, ..., $5000)` with
 * thousands of parameters is slow to send and plan (Phase 15c measurements). Values must be UUIDs.
 */
export function anyUuid(column: AnyColumn, ids: readonly string[]): SQL {
  for (const id of ids) if (!UUID.test(id)) throw new TypeError('anyUuid: not a UUID');
  return sql`${column} = any(${`{${ids.join(',')}}`}::uuid[])`;
}

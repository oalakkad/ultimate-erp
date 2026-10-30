import { type TenantTransaction } from '@ultimate-erp/db';
import { sql } from 'drizzle-orm';

/**
 * Next document number for this company, e.g. `C-0001`, `EL-0042`: gap-free and never reused.
 * The sequence row is locked by the upsert until the caller's transaction ends, so concurrent
 * creates wait for each other instead of colliding (and a rollback gives the number back).
 */
export async function nextDocumentNumber(
  tx: TenantTransaction,
  tenantId: string,
  sequence: string,
  prefix: string,
): Promise<string> {
  const result = await tx.execute<{ value: string }>(sql`
    insert into number_sequences (tenant_id, name, next_value) values (${tenantId}, ${sequence}, 2)
    on conflict (tenant_id, name) do update set next_value = number_sequences.next_value + 1
    returning next_value - 1 as value`);
  const value = Number(result.rows[0]?.value);
  if (!Number.isInteger(value) || value < 1) throw new Error(`number sequence ${sequence} failed`);
  return `${prefix}-${String(value).padStart(4, '0')}`;
}

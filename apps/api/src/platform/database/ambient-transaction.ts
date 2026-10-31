import { AsyncLocalStorage } from 'node:async_hooks';
import { type TenantTransaction } from '@ultimate-erp/db';

interface Ambient {
  tx: TenantTransaction;
  active: boolean;
}

const storage = new AsyncLocalStorage<Ambient>();

/** Runs `fn` with `tx` as the ambient transaction of its async call chain (TenantDatabase). */
export async function runInTransaction<T>(tx: TenantTransaction, fn: () => Promise<T>): Promise<T> {
  const ambient: Ambient = { tx, active: true };
  try {
    return await storage.run(ambient, fn);
  } finally {
    // Work that outlives the transaction (a promise not awaited) must never reuse it: its
    // connection may already serve another request.
    ambient.active = false;
  }
}

/**
 * The company transaction the current code runs inside, if it is still open. Read-only lookups
 * of global tables (account names, contacts) use it instead of a second pooled connection: a
 * request holding one connection while waiting for another can exhaust the pool under load and
 * stall every request (found by the Phase 15b deployment test).
 */
export function ambientTransaction(): TenantTransaction | undefined {
  const ambient = storage.getStore();
  return ambient?.active ? ambient.tx : undefined;
}

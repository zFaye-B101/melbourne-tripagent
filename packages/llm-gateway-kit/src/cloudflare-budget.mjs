import { createSerializedBudgetLedger } from './budget-ledger.mjs';

/**
 * Adapter for SQLite-backed Durable Object storage, used *inside* one DO.
 * All requests for one budget must reach the same DO identity.
 */
export function createCloudflareSqliteBudgetLedger({ storage, budgetId, limitUnits } = {}) {
  if (!storage || typeof storage.transactionSync !== 'function' ||
    !storage.kv || typeof storage.kv.get !== 'function' || typeof storage.kv.put !== 'function')
    throw new TypeError('SQLite-backed Durable Object storage is required');
  return createSerializedBudgetLedger({
    budgetId,
    limitUnits,
    transactionSync: (fn) => storage.transactionSync(() => fn(storage.kv)),
  });
}

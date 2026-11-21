import type { BudgetLedger, SyncBudgetStorage } from './budget-ledger.mjs';
export interface CloudflareSqliteBudgetStorage {
  transactionSync<T>(fn: () => T): T;
  kv: SyncBudgetStorage;
}
export function createCloudflareSqliteBudgetLedger(options: {
  storage: CloudflareSqliteBudgetStorage;
  budgetId: string;
  limitUnits: number;
}): BudgetLedger;

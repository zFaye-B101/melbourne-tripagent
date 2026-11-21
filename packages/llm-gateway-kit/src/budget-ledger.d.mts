export type BudgetOutcome = 'success' | 'unknown';
export interface SyncBudgetStorage {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
}
export interface BudgetLedgerOptions {
  /** Must be a real cross-instance serializable transaction, never a local Map in production. */
  transactionSync: <T>(fn: (storage: SyncBudgetStorage) => T) => T;
  /** Fixed on the server for one budget period. Never accept this from a request. */
  budgetId: string;
  /** Worst-case total spend in one deployment-defined integer currency unit. */
  limitUnits: number;
}
export interface BudgetLedger {
  reserve(input: { requestId: string; subjectKey: string; maxCostUnits: number }): { reservationId: string } | null;
  settle(input: { reservationId: string; subjectKey: string; outcome: BudgetOutcome }): boolean;
  snapshot(): { limitUnits: number; allocatedUnits: number; remainingUnits: number };
}
export function createSerializedBudgetLedger(options: BudgetLedgerOptions): BudgetLedger;

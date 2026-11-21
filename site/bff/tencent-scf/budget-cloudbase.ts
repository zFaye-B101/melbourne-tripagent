import type { BudgetPort } from '../budget-gate';

type BudgetState = {
  limitUnits: number;
  allocatedUnits: number;
  windowMinute: string;
  windowCount: number;
};

type DocumentRef = {
  get(): Promise<{ data?: unknown }>;
  set(data: BudgetState): Promise<unknown>;
};

export type CloudbaseBudgetDatabase = {
  runTransaction<T>(
    callback: (transaction: {
      collection(name: string): { doc(id: string): DocumentRef };
    }) => Promise<T>,
    retries?: number,
  ): Promise<{ result?: T; errMsg?: string }>;
};

export type CloudbaseBudgetConfig = {
  budgetPeriod: string;
  limitUnits: number;
  maxCallsPerMinute: number;
};

const collectionName = 'tripagent_budgets';

/**
 * One pre-seeded document is the sole cross-instance admission counter.
 * Every successful reserve permanently allocates its upper-bound units; a
 * failed provider call does not refund them. This deliberately favors a hard
 * spending ceiling over utilization. The provider call is outside the DB
 * transaction, as required by CloudBase's transaction guidance.
 */
export function createCloudbaseBudgetPort(
  db: CloudbaseBudgetDatabase,
  config: CloudbaseBudgetConfig,
  now: () => Date = () => new Date(),
): BudgetPort {
  if (
    !db ||
    typeof db.runTransaction !== 'function' ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(config.budgetPeriod) ||
    !positiveInteger(config.limitUnits) ||
    !positiveInteger(config.maxCallsPerMinute)
  )
    throw new TypeError('cloudbase_budget_configuration_invalid');

  return {
    async reserve({ requestId, subjectKey, maxCostUnits }) {
      if (
        !safeId(requestId) ||
        subjectKey !== 'public-demo' ||
        !positiveInteger(maxCostUnits)
      )
        return null;
      const minute = now().toISOString().slice(0, 16);
      const transaction = await db.runTransaction(async (tx) => {
        const document = tx.collection(collectionName).doc(config.budgetPeriod);
        const stored = await document.get();
        const state = parseState(stored.data, config.limitUnits);
        const count = state.windowMinute === minute ? state.windowCount : 0;
        if (
          count >= config.maxCallsPerMinute ||
          maxCostUnits > config.limitUnits - state.allocatedUnits
        )
          return { admitted: false };
        const write = await document.set({
          limitUnits: state.limitUnits,
          allocatedUnits: state.allocatedUnits + maxCostUnits,
          windowMinute: minute,
          windowCount: count + 1,
        });
        if (
          write &&
          typeof write === 'object' &&
          'code' in write &&
          typeof write.code === 'string' &&
          write.code.length > 0
        )
          throw new Error('cloudbase_budget_write_failed');
        return { admitted: true };
      }, 3);
      if (transaction?.errMsg !== 'runTransaction:ok')
        throw new Error('cloudbase_transaction_unconfirmed');
      return transaction.result?.admitted ? { reservationId: requestId } : null;
    },
    // The reservation is charged at admission and never released. The
    // upstream gate still calls settle; no second write is necessary.
    settle({ reservationId, subjectKey, outcome }) {
      return (
        safeId(reservationId) &&
        subjectKey === 'public-demo' &&
        (outcome === 'success' || outcome === 'unknown')
      );
    },
  };
}

function parseState(value: unknown, expectedLimit: number): BudgetState {
  const document =
    Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error('budget_document_missing');
  const state = document as Record<string, unknown>;
  if (
    state.limitUnits !== expectedLimit ||
    !Number.isSafeInteger(state.allocatedUnits) ||
    (state.allocatedUnits as number) < 0 ||
    (state.allocatedUnits as number) > expectedLimit ||
    typeof state.windowMinute !== 'string' ||
    (state.windowMinute !== '' &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(state.windowMinute)) ||
    !Number.isSafeInteger(state.windowCount) ||
    (state.windowCount as number) < 0
  )
    throw new Error('budget_document_invalid');
  return state as BudgetState;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeId(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

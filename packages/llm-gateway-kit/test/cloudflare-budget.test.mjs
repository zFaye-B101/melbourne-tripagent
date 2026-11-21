import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareSqliteBudgetLedger } from '../src/cloudflare-budget.mjs';

test('SQLite Durable Object adapter uses a synchronous transaction for every operation', () => {
  const values = new Map(); let transactions = 0;
  const storage = {
    kv: { get: (key) => values.get(key), put: (key, value) => { values.set(key, value); } },
    transactionSync: (fn) => { transactions++; return fn(); },
  };
  const budget = createCloudflareSqliteBudgetLedger({ storage, budgetId: 'trip-demo', limitUnits: 4 });
  assert.deepEqual(budget.reserve({ requestId: 'request-1', subjectKey: 'visitor-1', maxCostUnits: 3 }), { reservationId: 'request-1' });
  assert.equal(budget.reserve({ requestId: 'request-2', subjectKey: 'visitor-2', maxCostUnits: 2 }), null);
  assert.equal(budget.settle({ reservationId: 'request-1', subjectKey: 'visitor-1', outcome: 'unknown' }), true);
  assert.deepEqual(budget.snapshot(), { limitUnits: 4, allocatedUnits: 3, remainingUnits: 1 });
  assert.equal(transactions, 4);
});

test('missing SQLite transaction support refuses to create an adapter', () => {
  assert.throws(() => createCloudflareSqliteBudgetLedger({ storage: { kv: {} }, budgetId: 'trip-demo', limitUnits: 4 }), TypeError);
});

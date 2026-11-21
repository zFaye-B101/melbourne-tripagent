import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerializedBudgetLedger } from '../src/budget-ledger.mjs';

function memoryStore(map = new Map()) {
  return { transactionSync: (fn) => fn({ get: (key) => map.get(key), put: (key, value) => map.set(key, value) }), map };
}
function ledger(store = memoryStore(), options = {}) {
  return createSerializedBudgetLedger({ transactionSync: store.transactionSync, budgetId: 'demo-2026-09', limitUnits: 10, ...options });
}

test('reserves worst-case units and stops at the hard cap', () => {
  const budget = ledger();
  assert.deepEqual(budget.reserve({ requestId: 'a', subjectKey: 'visitor-1', maxCostUnits: 6 }), { reservationId: 'a' });
  assert.equal(budget.reserve({ requestId: 'b', subjectKey: 'visitor-2', maxCostUnits: 5 }), null);
  assert.deepEqual(budget.reserve({ requestId: 'c', subjectKey: 'visitor-2', maxCostUnits: 4 }), { reservationId: 'c' });
  assert.deepEqual(budget.snapshot(), { limitUnits: 10, allocatedUnits: 10, remainingUnits: 0 });
});

test('duplicate request IDs cannot admit a second model call or hijack a reservation', () => {
  const store = memoryStore();
  const first = ledger(store);
  assert.deepEqual(first.reserve({ requestId: 'a', subjectKey: 'visitor-1', maxCostUnits: 7 }), { reservationId: 'a' });
  const restarted = ledger(store);
  assert.equal(restarted.reserve({ requestId: 'a', subjectKey: 'visitor-1', maxCostUnits: 7 }), null);
  assert.equal(restarted.reserve({ requestId: 'a', subjectKey: 'visitor-2', maxCostUnits: 7 }), null);
  assert.equal(restarted.reserve({ requestId: 'a', subjectKey: 'visitor-1', maxCostUnits: 1 }), null);
  assert.deepEqual(restarted.snapshot(), { limitUnits: 10, allocatedUnits: 7, remainingUnits: 3 });
});

test('success and unknown settlements never refund the reservation', () => {
  const budget = ledger();
  budget.reserve({ requestId: 'a', subjectKey: 'visitor-1', maxCostUnits: 6 });
  assert.equal(budget.settle({ reservationId: 'a', subjectKey: 'visitor-1', outcome: 'unknown' }), true);
  assert.equal(budget.settle({ reservationId: 'a', subjectKey: 'visitor-1', outcome: 'unknown' }), true);
  assert.equal(budget.settle({ reservationId: 'a', subjectKey: 'visitor-1', outcome: 'success' }), false);
  assert.equal(budget.settle({ reservationId: 'a', subjectKey: 'visitor-2', outcome: 'unknown' }), false);
  assert.equal(budget.settle({ reservationId: 'missing', subjectKey: 'visitor-1', outcome: 'unknown' }), false);
  assert.equal(budget.reserve({ requestId: 'a', subjectKey: 'visitor-1', maxCostUnits: 6 }), null);
  assert.deepEqual(budget.snapshot(), { limitUnits: 10, allocatedUnits: 6, remainingUnits: 4 });
});

test('two instances sharing one serialized store cannot exceed the cap', async () => {
  const store = memoryStore();
  const a = ledger(store); const b = ledger(store);
  const results = await Promise.all(Array.from({ length: 20 }, (_, n) =>
    Promise.resolve().then(() => (n % 2 ? a : b).reserve({
      requestId: `r-${n}`, subjectKey: `visitor-${n}`, maxCostUnits: 1,
    }))));
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal(a.snapshot().allocatedUnits, 10);
});

test('many varied reservations preserve the cap and never re-admit a request ID', () => {
  let seed = 0x5eed;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let scenario = 0; scenario < 25; scenario++) {
    const store = memoryStore();
    const budget = ledger(store, { budgetId: `scenario-${scenario}`, limitUnits: 73 });
    let admitted = 0;
    for (let attempt = 0; attempt < 150; attempt++) {
      const requestId = `request-${next() % 90}`;
      const units = 1 + (next() % 17);
      const result = budget.reserve({ requestId, subjectKey: 'visitor', maxCostUnits: units });
      if (result) {
        admitted += units;
        assert.equal(budget.reserve({ requestId, subjectKey: 'visitor', maxCostUnits: units }), null);
      }
      const snapshot = budget.snapshot();
      assert.equal(snapshot.allocatedUnits, admitted);
      assert.ok(snapshot.allocatedUnits <= 73);
      assert.equal(snapshot.remainingUnits, 73 - admitted);
    }
  }
});

test('missing or changed policy and corrupt state fail closed', () => {
  assert.throws(() => ledger(memoryStore(), { limitUnits: 0 }), TypeError);
  assert.throws(() => ledger(memoryStore(), { budgetId: '../other' }), TypeError);
  assert.throws(() => createSerializedBudgetLedger({ budgetId: 'demo', limitUnits: 10 }), TypeError);
  const store = memoryStore();
  ledger(store).reserve({ requestId: 'a', subjectKey: 'visitor-1', maxCostUnits: 1 });
  assert.throws(() => ledger(store, { limitUnits: 20 }).reserve({ requestId: 'b', subjectKey: 'visitor-1', maxCostUnits: 1 }), /budget_state_unavailable/);
  store.map.set('budget:demo-2026-09:state', { limitUnits: 10, allocatedUnits: -1 });
  assert.throws(() => ledger(store).reserve({ requestId: 'b', subjectKey: 'visitor-1', maxCostUnits: 1 }), /budget_state_unavailable/);
});

test('a failed reservation write burns capacity rather than creating an uncounted call', () => {
  const map = new Map();
  const transactionSync = (fn) => fn({
    get: (key) => map.get(key),
    put: (key, value) => { if (key.includes(':reservation:')) throw new Error('storage_failed'); map.set(key, value); },
  });
  const budget = createSerializedBudgetLedger({ transactionSync, budgetId: 'demo', limitUnits: 10 });
  assert.throws(() => budget.reserve({ requestId: 'a', subjectKey: 'visitor-1', maxCostUnits: 6 }), /storage_failed/);
  assert.equal(map.get('budget:demo:state').allocatedUnits, 6);
});

test('async storage adapters and unsafe units cannot be admitted', () => {
  const budget = ledger();
  assert.equal(budget.reserve({ requestId: 'a', subjectKey: 'visitor-1', maxCostUnits: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.throws(() => createSerializedBudgetLedger({ transactionSync: async (fn) => fn({ get() {}, put() {} }), budgetId: 'demo', limitUnits: 10 }).snapshot(), /transactionSync must not return a Promise/);
});

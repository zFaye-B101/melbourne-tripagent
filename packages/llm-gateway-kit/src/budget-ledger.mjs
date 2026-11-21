/**
 * Conservative budget accounting for one server-owned budget period.
 * The adapter MUST serialize every transaction across all callers/instances.
 */
export function createSerializedBudgetLedger({ transactionSync, budgetId, limitUnits } = {}) {
  if (typeof transactionSync !== 'function') throw new TypeError('transactionSync is required');
  if (typeof budgetId !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(budgetId)) throw new TypeError('budgetId is invalid');
  if (!positiveSafeInteger(limitUnits)) throw new TypeError('limitUnits must be a positive safe integer');

  const stateKey = `budget:${budgetId}:state`;
  const reservationKey = (id) => `budget:${budgetId}:reservation:${id}`;

  function atomic(fn) {
    const result = transactionSync((tx) => {
      if (!tx || typeof tx.get !== 'function' || typeof tx.put !== 'function') throw new TypeError('synchronous transaction storage is required');
      const syncStorage = {
        get(key) {
          const value = tx.get(key);
          if (value && typeof value.then === 'function') throw new TypeError('storage.get must be synchronous');
          return value;
        },
        put(key, value) {
          const result = tx.put(key, value);
          if (result && typeof result.then === 'function') throw new TypeError('storage.put must be synchronous');
        },
      };
      return fn(syncStorage);
    });
    if (result && typeof result.then === 'function') throw new TypeError('transactionSync must not return a Promise');
    return result;
  }

  function reserve({ requestId, subjectKey, maxCostUnits } = {}) {
    if (!safeId(requestId) || !safeId(subjectKey) || !positiveSafeInteger(maxCostUnits)) return null;
    return atomic((tx) => {
      const saved = tx.get(stateKey);
      const state = saved === undefined ? { limitUnits, allocatedUnits: 0 } : checkedState(saved, limitUnits);
      const key = reservationKey(requestId);
      const existing = tx.get(key);
      if (existing !== undefined) {
        checkedReservation(existing);
        // A repeated ID may represent an already-started provider call. Never
        // hand a second caller the same reservation as a new admission token.
        return null;
      }
      if (maxCostUnits > limitUnits - state.allocatedUnits) return null;
      // Never reduce allocatedUnits automatically. Write the total first so a
      // broken non-transactional adapter fails closed rather than overspending.
      tx.put(stateKey, { limitUnits, allocatedUnits: state.allocatedUnits + maxCostUnits });
      tx.put(key, { subjectKey, maxCostUnits, outcome: 'pending' });
      return { reservationId: requestId };
    });
  }

  function settle({ reservationId, subjectKey, outcome } = {}) {
    if (!safeId(reservationId) || !safeId(subjectKey) || (outcome !== 'success' && outcome !== 'unknown')) return false;
    return atomic((tx) => {
      checkedState(tx.get(stateKey), limitUnits);
      const key = reservationKey(reservationId);
      const existing = tx.get(key);
      if (existing === undefined) return false;
      const record = checkedReservation(existing);
      if (record.subjectKey !== subjectKey) return false;
      if (record.outcome === outcome) return true;
      if (record.outcome !== 'pending') return false;
      tx.put(key, { ...record, outcome });
      return true;
    });
  }

  function snapshot() {
    return atomic((tx) => {
      const saved = tx.get(stateKey);
      const state = saved === undefined ? { limitUnits, allocatedUnits: 0 } : checkedState(saved, limitUnits);
      return { ...state, remainingUnits: limitUnits - state.allocatedUnits };
    });
  }

  return { reserve, settle, snapshot };
}

function positiveSafeInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value); }
function checkedState(value, expectedLimit) {
  if (!value || typeof value !== 'object' || value.limitUnits !== expectedLimit ||
    !Number.isSafeInteger(value.allocatedUnits) || value.allocatedUnits < 0 || value.allocatedUnits > expectedLimit)
    throw new Error('budget_state_unavailable');
  return value;
}
function checkedReservation(value) {
  if (!value || typeof value !== 'object' || !safeId(value.subjectKey) || !positiveSafeInteger(value.maxCostUnits) ||
    !['pending', 'success', 'unknown'].includes(value.outcome)) throw new Error('budget_reservation_unavailable');
  return value;
}

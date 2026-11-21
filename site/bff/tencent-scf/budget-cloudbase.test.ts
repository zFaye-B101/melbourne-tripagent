import { describe, expect, it } from 'vitest';
import {
  createCloudbaseBudgetPort,
  type CloudbaseBudgetDatabase,
} from './budget-cloudbase';

type State = {
  limitUnits: number;
  allocatedUnits: number;
  windowMinute: string;
  windowCount: number;
};

function fakeDatabase(initial?: State) {
  let stored = initial;
  let tail = Promise.resolve();
  const db: CloudbaseBudgetDatabase = {
    async runTransaction<T>(
      callback: Parameters<CloudbaseBudgetDatabase['runTransaction']>[0],
    ) {
      const prior = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      try {
        let next: State | undefined;
        const result = await callback({
          collection(name) {
            expect(name).toBe('tripagent_budgets');
            return {
              doc(id) {
                expect(id).toBe('demo-2026-09');
                return {
                  async get() {
                    return { data: stored ? [{ ...stored }] : [] };
                  },
                  async set(data) {
                    next = { ...data };
                  },
                };
              },
            };
          },
        });
        if (next) stored = next;
        return { result: result as T, errMsg: 'runTransaction:ok' };
      } finally {
        release();
      }
    },
  };
  return { db, snapshot: () => stored };
}

const config = {
  budgetPeriod: 'demo-2026-09',
  limitUnits: 3,
  maxCallsPerMinute: 2,
};

describe('CloudBase shared budget', () => {
  it('fails closed without a pre-seeded budget document', async () => {
    const { db } = fakeDatabase();
    const port = createCloudbaseBudgetPort(db, config);
    await expect(
      port.reserve({
        requestId: 'r1',
        subjectKey: 'public-demo',
        maxCostUnits: 1,
      }),
    ).rejects.toThrow('budget_document_missing');
  });

  it('atomically limits concurrent callers across instances', async () => {
    const { db, snapshot } = fakeDatabase({
      limitUnits: 3,
      allocatedUnits: 0,
      windowMinute: '',
      windowCount: 0,
    });
    const now = () => new Date('2026-09-17T10:01:00Z');
    const first = createCloudbaseBudgetPort(db, config, now);
    const second = createCloudbaseBudgetPort(db, config, now);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve(
          (i % 2 ? first : second).reserve({
            requestId: `r${i}`,
            subjectKey: 'public-demo',
            maxCostUnits: 1,
          }),
        ),
      ),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(2);
    expect(snapshot()).toEqual({
      limitUnits: 3,
      allocatedUnits: 2,
      windowMinute: '2026-09-17T10:01',
      windowCount: 2,
    });
  });

  it('retains charged units after a new minute and never refunds on failure', async () => {
    const { db, snapshot } = fakeDatabase({
      limitUnits: 3,
      allocatedUnits: 2,
      windowMinute: '2026-09-17T10:01',
      windowCount: 2,
    });
    const port = createCloudbaseBudgetPort(
      db,
      config,
      () => new Date('2026-09-17T10:02:00Z'),
    );
    expect(
      await port.reserve({
        requestId: 'next',
        subjectKey: 'public-demo',
        maxCostUnits: 1,
      }),
    ).toEqual({ reservationId: 'next' });
    expect(
      await port.settle({
        reservationId: 'next',
        subjectKey: 'public-demo',
        outcome: 'unknown',
      }),
    ).toBe(true);
    expect(snapshot()?.allocatedUnits).toBe(3);
    expect(
      await port.reserve({
        requestId: 'later',
        subjectKey: 'public-demo',
        maxCostUnits: 1,
      }),
    ).toBeNull();
  });

  it('rejects invalid or unconfirmed storage results', async () => {
    const { db } = fakeDatabase({
      limitUnits: 100,
      allocatedUnits: 0,
      windowMinute: '',
      windowCount: 0,
    });
    const port = createCloudbaseBudgetPort(db, config);
    await expect(
      port.reserve({
        requestId: 'bad',
        subjectKey: 'public-demo',
        maxCostUnits: 1,
      }),
    ).rejects.toThrow('budget_document_invalid');
    expect(
      await port.reserve({
        requestId: 'bad',
        subjectKey: 'other',
        maxCostUnits: 1,
      }),
    ).toBeNull();
  });
});

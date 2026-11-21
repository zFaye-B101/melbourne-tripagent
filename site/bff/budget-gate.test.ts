import { describe, expect, it, vi } from 'vitest';
import type { NluDraftAdapter } from '../app/lib/nlu-contract';
import { createBudgetedNluAdapter } from './budget-gate';

const input = {
  text: '墨尔本玩两天',
  locale: 'zh-CN' as const,
  datasetVersion: 'test-data',
};

function options(signal = new AbortController().signal) {
  return { signal, deadlineMs: 4_000 };
}

function provider() {
  const call = vi.fn(async () => ({
    ok: true as const,
    draft: { days: 2 },
    promptVersion: 'test',
    datasetVersion: 'test-data',
  }));
  return { model: { extractDraft: call } satisfies NluDraftAdapter, call };
}

describe('TripAgent reserved-budget adapter', () => {
  it('never calls the provider when the shared budget is exhausted', async () => {
    const { model, call } = provider();
    const settle = vi.fn();
    const guarded = createBudgetedNluAdapter(
      model,
      { reserve: vi.fn(async () => null), settle },
      'request-1',
      3,
    );
    await expect(guarded.extractDraft(input, options())).resolves.toEqual({
      ok: false,
      code: 'rate_limited',
    });
    expect(call).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it('reserves before the model and settles a successful response', async () => {
    const order: string[] = [];
    const model: NluDraftAdapter = {
      extractDraft: vi.fn(async () => {
        order.push('model');
        return {
          ok: true as const,
          draft: {},
          promptVersion: 'test',
          datasetVersion: 'test-data',
        };
      }),
    };
    const guarded = createBudgetedNluAdapter(
      model,
      {
        reserve: vi.fn(async (value) => {
          order.push('reserve');
          expect(value).toEqual({
            requestId: 'request-2',
            subjectKey: 'public-demo',
            maxCostUnits: 3,
          });
          return { reservationId: 'request-2' };
        }),
        settle: vi.fn(async (value) => {
          order.push('settle');
          expect(value).toEqual({
            reservationId: 'request-2',
            subjectKey: 'public-demo',
            outcome: 'success',
          });
          return true;
        }),
      },
      'request-2',
      3,
    );
    expect((await guarded.extractDraft(input, options())).ok).toBe(true);
    expect(order).toEqual(['reserve', 'model', 'settle']);
  });

  it('records an unknown outcome when the model fails or throws', async () => {
    for (const modelResult of ['error', 'throw'] as const) {
      const model: NluDraftAdapter = {
        extractDraft: vi.fn(async () => {
          if (modelResult === 'throw') throw new Error('private detail');
          return { ok: false as const, code: 'invalid_json' as const };
        }),
      };
      const settle = vi.fn(async () => true);
      const guarded = createBudgetedNluAdapter(
        model,
        { reserve: async () => ({ reservationId: 'request-3' }), settle },
        'request-3',
        3,
      );
      expect((await guarded.extractDraft(input, options())).ok).toBe(false);
      expect(settle).toHaveBeenCalledWith({
        reservationId: 'request-3',
        subjectKey: 'public-demo',
        outcome: 'unknown',
      });
    }
  });

  it('does not call the model if aborted after reservation', async () => {
    const controller = new AbortController();
    const { model, call } = provider();
    const settle = vi.fn(async () => true);
    const guarded = createBudgetedNluAdapter(
      model,
      {
        reserve: async () => {
          controller.abort();
          return { reservationId: 'request-4' };
        },
        settle,
      },
      'request-4',
      3,
    );
    await expect(
      guarded.extractDraft(input, options(controller.signal)),
    ).resolves.toEqual({ ok: false, code: 'deadline_exceeded' });
    expect(call).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'unknown' }),
    );
  });

  it('fails closed on malformed admission and settlement failure', async () => {
    const { model, call } = provider();
    const wrongId = createBudgetedNluAdapter(
      model,
      {
        reserve: async () => ({ reservationId: 'another-request' }),
        settle: async () => true,
      },
      'request-5',
      3,
    );
    await expect(wrongId.extractDraft(input, options())).resolves.toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
    expect(call).not.toHaveBeenCalled();

    const failedSettle = createBudgetedNluAdapter(
      model,
      {
        reserve: async () => ({ reservationId: 'request-6' }),
        settle: async () => false,
      },
      'request-6',
      3,
    );
    await expect(failedSettle.extractDraft(input, options())).resolves.toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
  });

  it('settles unknown and rejects a malformed provider result', async () => {
    const settle = vi.fn(async () => true);
    const malformed = {
      extractDraft: vi.fn(async () => undefined),
    } as unknown as NluDraftAdapter;
    const guarded = createBudgetedNluAdapter(
      malformed,
      { reserve: async () => ({ reservationId: 'request-7' }), settle },
      'request-7',
      3,
    );
    await expect(guarded.extractDraft(input, options())).resolves.toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'unknown' }),
    );
  });

  it('rejects invalid server configuration', () => {
    const { model } = provider();
    const budget = {
      reserve: async () => ({ reservationId: 'request' }),
      settle: async () => true,
    };
    expect(() => createBudgetedNluAdapter(model, budget, '../request', 1)).toThrow(TypeError);
    expect(() => createBudgetedNluAdapter(model, budget, 'request', 0)).toThrow(TypeError);
    expect(() => createBudgetedNluAdapter(model, budget, undefined as unknown as string, 1)).toThrow(TypeError);
  });
});

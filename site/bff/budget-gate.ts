import type { NluDraftAdapter } from '../app/lib/nlu-contract';

export interface BudgetPort {
  reserve(input: {
    requestId: string;
    subjectKey: string;
    maxCostUnits: number;
  }): Promise<{ reservationId: string } | null> | { reservationId: string } | null;
  settle(input: {
    reservationId: string;
    subjectKey: string;
    outcome: 'success' | 'unknown';
  }): Promise<boolean> | boolean;
}

/** The port must use a persistent, cross-instance atomic budget backend. */
export function createBudgetedNluAdapter(
  provider: NluDraftAdapter,
  budget: BudgetPort,
  requestId: string,
  maxCostUnits: number,
  subjectKey = 'public-demo',
): NluDraftAdapter {
  if (
    !provider ||
    typeof provider.extractDraft !== 'function' ||
    !budget ||
    typeof budget.reserve !== 'function' ||
    typeof budget.settle !== 'function' ||
    !safeId(requestId) ||
    !safeId(subjectKey) ||
    !Number.isSafeInteger(maxCostUnits) ||
    maxCostUnits <= 0
  )
    throw new TypeError('budget gate configuration is invalid');

  return {
    async extractDraft(input, options) {
      if (options.signal.aborted)
        return { ok: false, code: 'deadline_exceeded' };

      let reservation: { reservationId: string } | null;
      try {
        reservation = await budget.reserve({
          requestId,
          subjectKey,
          maxCostUnits,
        });
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
      if (reservation === null) return { ok: false, code: 'rate_limited' };
      if (!reservation || reservation.reservationId !== requestId)
        return { ok: false, code: 'provider_unavailable' };

      let result: Awaited<ReturnType<NluDraftAdapter['extractDraft']>>;
      if (options.signal.aborted) {
        result = { ok: false, code: 'deadline_exceeded' };
      } else {
        try {
          result = await provider.extractDraft(input, options);
        } catch {
          result = { ok: false, code: 'provider_unavailable' };
        }
      }

      const validResult =
        result && typeof result === 'object' && typeof result.ok === 'boolean';
      try {
        const settled = await budget.settle({
          reservationId: requestId,
          subjectKey,
          outcome: validResult && result.ok ? 'success' : 'unknown',
        });
        if (settled !== true)
          return { ok: false, code: 'provider_unavailable' };
      } catch {
        return { ok: false, code: 'provider_unavailable' };
      }
      return validResult ? result : { ok: false, code: 'provider_unavailable' };
    },
  };
}

function safeId(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

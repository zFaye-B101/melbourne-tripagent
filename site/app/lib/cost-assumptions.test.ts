import { describe, expect, it } from 'vitest';

import {
  assumptionCostItems,
  parseAudRangeInput,
  parseCostAssumptions,
} from './cost-assumptions';
import {
  mergeStructuredTripRequest,
  parseTripRequest,
  planTrip,
  type PlannerResult,
} from './planner';

function plan(text: string): PlannerResult {
  const outcome = planTrip(parseTripRequest(text));
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.result;
}

describe('parseCostAssumptions', () => {
  it('reads lodging per night, nights and food per person per day (eval task 22)', () => {
    const { value, warnings } = parseCostAssumptions(
      '住宿预计每晚 A$100–150、住 1 晚，餐饮每人每天 A$30–50，请重新估算。',
    );
    expect(warnings).toEqual([]);
    expect(value.accommodation).toMatchObject({
      perNightMinCents: 10000,
      perNightMaxCents: 15000,
      nights: 1,
      source: 'text',
    });
    expect(value.food).toMatchObject({
      perPersonPerDayMinCents: 3000,
      perPersonPerDayMaxCents: 5000,
    });
  });

  it('does not infer nights from trip days', () => {
    const { value } = parseCostAssumptions('玩 3 天，住宿每晚 120 澳元');
    expect(value.accommodation).toMatchObject({
      perNightMinCents: 12000,
      perNightMaxCents: 12000,
      nights: null,
    });
  });

  it('leaves both unknown when nothing is said', () => {
    expect(parseCostAssumptions('墨尔本玩 2 天，喜欢历史').value).toEqual({
      accommodation: null,
      food: null,
    });
  });

  it('refuses to convert other currencies', () => {
    const { value, warnings } = parseCostAssumptions('住宿每晚 500 人民币，住 2 晚');
    expect(value.accommodation).toBeNull();
    expect(warnings.join()).toContain('澳元');
  });
});

describe('assumptionCostItems', () => {
  it('multiplies by nights, travellers and days and never turns a gap into A$0', () => {
    const items = assumptionCostItems(
      {
        accommodation: {
          perNightMinCents: 10000,
          perNightMaxCents: 15000,
          nights: null,
          source: 'text',
          evidence: null,
        },
        food: {
          perPersonPerDayMinCents: 3000,
          perPersonPerDayMaxCents: 5000,
          source: 'text',
          evidence: null,
        },
      },
      { travelers: null, tripDays: 2 },
    );
    expect(items.map((item) => [item.id, item.minCents, item.missing])).toEqual([
      ['accommodation', null, '住几晚还没说明'],
      ['food', null, '同行人数还没确认'],
    ]);
  });
});

describe('budget disclosure and estimate (docs/42 CostItem)', () => {
  it('lists 住宿 as unknown when the traveller gave no lodging assumption (D1)', () => {
    const result = plan('两位成人玩 2 天，预算 A$300，偏好历史和地标。');
    expect(result.budget.coverage.unknownItems).toContain('住宿');
    expect(result.budget.coverage.unknownItems).toContain('餐饮');
    expect(result.budget.assumptionItems).toEqual([]);
    expect(result.budget.estimateRange).toBeNull();
    expect(result.budget.estimateComparison).toBeNull();
  });

  it('adds user assumptions as separate items and an estimate range', () => {
    const result = plan(
      '两位成人玩 2 天，喜欢历史；住宿每晚 A$100-150、住 1 晚，餐饮每人每天 A$30-50。',
    );
    const budget = result.budget;
    expect(budget.assumptionItems.map((item) => [item.id, item.minCents, item.maxCents])).toEqual([
      ['accommodation', 10000, 15000],
      ['food', 12000, 20000],
    ]);
    expect(budget.coverage.unknownItems).not.toContain('住宿');
    expect(budget.coverage.unknownItems).not.toContain('餐饮');
    expect(budget.coverage.excludedItems).not.toContain('餐饮');
    expect(budget.estimateRange?.minCents).toBe(
      (budget.knownComponentsRange.minCents ?? 0) + 22000,
    );
    // Verified components keep their own name; the estimate never replaces them.
    expect(budget.knownComponentsRange.minCents).toBeLessThan(
      budget.estimateRange?.minCents ?? 0,
    );
  });

  it('flags missing nights instead of guessing them', () => {
    const result = plan('一位成人玩 2 天，住宿每晚 A$120。');
    expect(result.budget.coverage.unknownItems).toContain('住宿晚数');
    expect(result.budget.estimateRange).toBeNull();
  });

  it('compares an estimate with the budget only as far as the numbers allow', () => {
    const over = plan(
      '一位成人玩 2 天，预算 A$100；住宿每晚 A$150、住 1 晚，餐饮每人每天 A$30。',
    );
    expect(over.budget.estimateComparison).toBe('estimate_min_exceeds_limit');
    const within = plan(
      '一位成人玩 1 天，喜欢花园，预算 A$1000；住宿每晚 A$100、住 1 晚，餐饮每人每天 A$30。',
    );
    expect(['estimate_within_limit', 'indeterminate']).toContain(
      within.budget.estimateComparison,
    );
    expect(within.budget.estimateComparison).not.toBe('estimate_min_exceeds_limit');
  });

  it('cannot price food for an uncounted child and says so', () => {
    const outcome = planTrip(
      parseTripRequest('带孩子玩 2 天，喜欢花园；餐饮每人每天 A$30。'),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.budget.coverage.unknownItems).toContain('住宿');
    expect(
      outcome.result.budget.assumptionItems.find((item) => item.id === 'food')?.missing,
    ).toBe('同行人数还没确认');
  });
});

describe('structured settings for cost assumptions', () => {
  it('lets detailed settings supply assumptions and flags a text/settings conflict', () => {
    const base = parseTripRequest('两位成人玩 2 天，住宿每晚 A$100、住 1 晚。');
    const merged = mergeStructuredTripRequest(base, {
      costAssumptions: {
        accommodation: {
          perNightMinCents: 20000,
          perNightMaxCents: 20000,
          nights: 1,
          source: 'structured',
          evidence: null,
        },
      },
    });
    expect(merged.settingConflicts.map((item) => item.field)).toContain('budget');

    const fresh = mergeStructuredTripRequest(parseTripRequest('两位成人玩 2 天'), {
      costAssumptions: {
        food: {
          perPersonPerDayMinCents: 3000,
          perPersonPerDayMaxCents: 3000,
          source: 'structured',
          evidence: null,
        },
      },
    });
    expect(fresh.errors).toEqual([]);
    expect(fresh.costAssumptions?.food?.perPersonPerDayMinCents).toBe(3000);
  });

  it('parses 100-150 style inputs', () => {
    expect(parseAudRangeInput('100-150')).toEqual({ min: 10000, max: 15000 });
    expect(parseAudRangeInput('A$120')).toEqual({ min: 12000, max: 12000 });
    expect(parseAudRangeInput('')).toBeUndefined();
    expect(parseAudRangeInput('一百')).toBeNull();
    expect(parseAudRangeInput('150-100')).toBeNull();
  });
});
